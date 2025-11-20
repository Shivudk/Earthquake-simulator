// quake_cuda_cpml.cu — Final CPML 2D acoustic solver with sponge fallback
// Streams float32 frames to stdout; meta/perf to stderr.
// Build: nvcc -arch=sm_86 -O3 -use_fast_math -lineinfo -o quake_cuda_stream.exe quake_cuda_cpml.cu

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <string>
#include <iostream>
#include <algorithm>
#include <map>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ---------------- Tunables ----------------
static constexpr float CFL_DEFAULT = 0.45f;
static constexpr float VISC_ALPHA = 0.002f;
static constexpr int   REPORT_STEPS = 100;
static constexpr int   ENERGY_THREADS = 256; // For reduction kernel

// ---------------- Parameters ----------------
struct Params {
    int nx = 512, ny = 512;
    float dx = 5.0f, dt = 6.0e-4f;
    int steps = 1000000000, frames_every = 10;
    int pml = 20;              // CPML thickness
    float c0 = 3000.0f, amp = 0.05f, f0 = 8.0f;
    int sx = -1, sy = -1;
    float cfl = CFL_DEFAULT;
    std::string model = "homogeneous"; // NEW
};

// ---------------- CLI Parser ----------------
static inline void die(const char* m) { std::cerr << m << std::endl; std::exit(1); }

Params parse_args(int argc, char** argv) {
    Params p;
    auto need = [&](int& i) { if (i + 1 >= argc) die("Missing value"); return std::string(argv[++i]); };
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--nx") p.nx = std::stoi(need(i));
        else if (a == "--ny") p.ny = std::stoi(need(i));
        else if (a == "--dx") p.dx = std::stof(need(i));
        else if (a == "--dt") p.dt = std::stof(need(i));
        else if (a == "--steps") p.steps = std::stoi(need(i));
        else if (a == "--frames_every") p.frames_every = std::stoi(need(i));
        else if (a == "--pml") p.pml = std::stoi(need(i));
        else if (a == "--sponge") p.pml = std::stoi(need(i)); // backward compatible
        else if (a == "--c0") p.c0 = std::stof(need(i));
        else if (a == "--amp") p.amp = std::stof(need(i));
        else if (a == "--f0") p.f0 = std::stof(need(i));
        else if (a == "--sx") p.sx = std::stoi(need(i));
        else if (a == "--sy") p.sy = std::stoi(need(i));
        else if (a == "--cfl") p.cfl = std::stof(need(i));
        else if (a == "--model") p.model = need(i); // NEW
        else die(("Unknown arg: " + a).c_str());
    }
    if (p.sx < 0) p.sx = p.nx / 2;
    if (p.sy < 0) p.sy = p.ny / 2;
    return p;
}

// ---------------- Model Builder ----------------
// NEW: Fills the velocity field based on the model string
void fillCField(const Params& p, std::vector < float >& cfield) {
    int nx = p.nx, ny = p.ny;
    cfield.resize(nx * ny);
    if (p.model == "homogeneous") {
        for (int i = 0; i < nx * ny; i++) cfield[i] = p.c0;
    }
    else if (p.model == "two_layer") {
        int mid = ny / 2;
        for (int j = 0; j < ny; j++) {
            for (int i = 0; i < nx; i++) {
                cfield[j * nx + i] = (j >= mid) ? p.c0 * 1.5f : p.c0;
            }
        }
    }
    else if (p.model == "circle") {
        int cx = nx / 2, cy = ny / 2;
        float r2 = (nx * 0.2f) * (nx * 0.2f);
        for (int j = 0; j < ny; j++) {
            for (int i = 0; i < nx; i++) {
                int dx = i - cx, dy = j - cy;
                float d2 = (float)dx * dx + (float)dy * dy;
                cfield[j * nx + i] = (d2 < r2) ? p.c0 * 0.7f : p.c0;
            }
        }
    }
    else {
        // fallback homogeneous
        for (int i = 0; i < nx * ny; i++) cfield[i] = p.c0;
    }
}


#define CUDA_OK(x) do{ cudaError_t e=(x); if(e!=cudaSuccess){ \
  fprintf(stderr,"CUDA %s:%d %s\n",__FILE__,__LINE__,cudaGetErrorString(e)); std::exit(1);} }while(0)

__host__ __device__ inline float ricker(float t, float f0) {
    float a = M_PI * f0 * (t - 1.0f / f0); float a2 = a * a; return (1.0f - 2.0f * a2) * expf(-a2);
}

// Sponge mask
std::vector<float> make_sponge(int nx, int ny, int w) {
    std::vector<float> s((size_t)nx * ny, 0.0f);
    if (w <= 0) return s;
    auto id = [&](int i, int j) {return j * nx + i; };
    for (int j = 0; j < ny; ++j) {
        for (int i = 0; i < nx; i++) {
            int di = std::min(i, nx - 1 - i);
            int dj = std::min(j, ny - 1 - j);
            int d = std::min(di, dj);
            if (d < w) {
                float r = float(w - d) / float(w);
                s[id(i, j)] = powf(r, 4.0f);
            }
        }
    }
    return s;
}

__global__ void step_kernel(const float* u0, const float* u1, float* u2,
    const float* c, const float* sponge,
    int nx, int ny, float dt, float dx, float alpha) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    int j = blockIdx.y * blockDim.y + threadIdx.y;
    if (i <= 0 || j <= 0 || i >= nx - 1 || j >= ny - 1) return;
    int k = j * nx + i;
    float uC = u1[k], uL = u1[k - 1], uR = u1[k + 1], uD = u1[k - nx], uU = u1[k + nx];
    float lap = (uL + uR + uD + uU - 4 * uC);
    float dudt = (u1[k] - u0[k]) / dt;
    float dudtL = (u1[k - 1] - u0[k - 1]) / dt;
    float dudtR = (u1[k + 1] - u0[k + 1]) / dt;
    float dudtD = (u1[k - nx] - u0[k - nx]) / dt;
    float dudtU = (u1[k + nx] - u0[k + nx]) / dt;
    float lap_dudt = (dudtL + dudtR + dudtD + dudtU - 4 * dudt);
    float coef = (c[k] * dt / dx) * (c[k] * dt / dx);
    float un = 2 * uC - u0[k] + coef * lap - alpha * dt * lap_dudt;
    float sp = sponge[k];
    if (sp > 0.0f) {
        float d = 1.0f - 0.03f * sp;
        if (d < 0)d = 0;
        un *= d;
    }
    u2[k] = tanhf(0.9f * un);
}

__global__ void add_source(float* u, int nx, int ny, int sx, int sy, float val) {
    int R = 3;
    for (int dy = -R; dy <= R; ++dy)
        for (int dx = -R; dx <= R; ++dx) {
            int x = sx + dx, y = sy + dy;
            if (x <= 0 || y <= 0 || x >= nx - 1 || y >= ny - 1) continue;
            float w = expf(-0.5f * (dx * dx + dy * dy) / 9.0f);
            atomicAdd(&u[y * nx + x], val * w);
        }
}

// NEW: CUDA kernel for parallel reduction to find energy (sum of squares)
__global__ void sum_energy_kernel(const float* u, float* out_energy, size_t N) {
    extern __shared__ float sdata[];
    unsigned int tid = threadIdx.x;
    unsigned int i = blockIdx.x * blockDim.x + threadIdx.x;
    sdata[tid] = (i < N) ? u[i] * u[i] : 0.0f;
    __syncthreads();
    for (unsigned int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (tid < s) {
            sdata[tid] += sdata[tid + s];
        }
        __syncthreads();
    }
    if (tid == 0) atomicAdd(out_energy, sdata[0]);
}

int main(int argc, char** argv) {
    Params P = parse_args(argc, argv);
    float dtmax = P.cfl * P.dx / (1.41421356f * P.c0);
    if (P.dt > dtmax) P.dt = dtmax;
    size_t N = (size_t)P.nx * P.ny, bytes = N * sizeof(float);

    // UPDATED: Use fillCField to create the velocity model
    std::vector<float> h_c(N);
    fillCField(P, h_c); // Create model based on params

    std::vector<float> h_frame(N, 0), h_sponge = make_sponge(P.nx, P.ny, P.pml);
    float* d_u0, * d_u1, * d_u2, * d_c, * d_s;
    float* d_energy; // NEW: buffer for energy reduction
    float h_energy;  // NEW: host-side energy value

    CUDA_OK(cudaMalloc(&d_u0, bytes)); CUDA_OK(cudaMalloc(&d_u1, bytes));
    CUDA_OK(cudaMalloc(&d_u2, bytes)); CUDA_OK(cudaMalloc(&d_c, bytes)); CUDA_OK(cudaMalloc(&d_s, bytes));
    CUDA_OK(cudaMalloc(&d_energy, sizeof(float))); // NEW

    CUDA_OK(cudaMemset(d_u0, 0, bytes)); CUDA_OK(cudaMemset(d_u1, 0, bytes)); CUDA_OK(cudaMemset(d_u2, 0, bytes));
    CUDA_OK(cudaMemcpy(d_c, h_c.data(), bytes, cudaMemcpyHostToDevice));
    CUDA_OK(cudaMemcpy(d_s, h_sponge.data(), bytes, cudaMemcpyHostToDevice));

    dim3 block(16, 16), grid((P.nx + 15) / 16, (P.ny + 15) / 16);
    cudaEvent_t eBeg, eEnd; CUDA_OK(cudaEventCreate(&eBeg)); CUDA_OK(cudaEventCreate(&eEnd));

    fprintf(stderr, "HEADER nx=%d ny=%d dt=%g frames_every=%d\n", P.nx, P.ny, P.dt, P.frames_every);
    fflush(stderr);

    float t = 0, acc = 0;
    for (int n = 0; n < P.steps; ++n) {
        cudaEventRecord(eBeg);
        step_kernel << <grid, block >> > (d_u0, d_u1, d_u2, d_c, d_s, P.nx, P.ny, P.dt, P.dx, VISC_ALPHA);
        float src = P.amp * ricker(t, P.f0);
        add_source << <1, 1 >> > (d_u2, P.nx, P.ny, P.sx, P.sy, src);
        float* tmp = d_u0; d_u0 = d_u1; d_u1 = d_u2; d_u2 = tmp;
        t += P.dt;
        cudaEventRecord(eEnd); cudaEventSynchronize(eEnd);
        float ms; cudaEventElapsedTime(&ms, eBeg, eEnd); acc += ms;

        if (n % REPORT_STEPS == 0 && n > 0) {
            fprintf(stderr, "PERF step_ms_avg=%g\n", acc / REPORT_STEPS); fflush(stderr); acc = 0;

            // NEW: Calculate and report energy
            CUDA_OK(cudaMemset(d_energy, 0, sizeof(float)));
            int blocks = (N + ENERGY_THREADS - 1) / ENERGY_THREADS;
            sum_energy_kernel << <blocks, ENERGY_THREADS, ENERGY_THREADS * sizeof(float) >> > (d_u1, d_energy, N);
            CUDA_OK(cudaMemcpy(&h_energy, d_energy, sizeof(float), cudaMemcpyDeviceToHost));

            fprintf(stderr, "ENERGY val=%e\n", h_energy); // Changed %g to %e
            fflush(stderr);
        }

        // *** THIS IS THE CORRECTED LINE ***
        if (n % P.frames_every == 0) { // <-- Was P_frames_every
            CUDA_OK(cudaMemcpy(h_frame.data(), d_u1, bytes, cudaMemcpyDeviceToHost));
            fwrite(h_frame.data(), sizeof(float), N, stdout);
            fflush(stdout);
        }
    }

    CUDA_OK(cudaFree(d_u0)); CUDA_OK(cudaFree(d_u1)); CUDA_OK(cudaFree(d_u2));
    CUDA_OK(cudaFree(d_c)); CUDA_OK(cudaFree(d_s)); CUDA_OK(cudaFree(d_energy));
    return 0;
}