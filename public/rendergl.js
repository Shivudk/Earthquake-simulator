// rendergl.js - Advanced WebGL2 Renderer with Velocity Overlay and Dynamic Colormaps
// Author: Earthquake GPU Simulation Lab 2025

class RendererGL {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext("webgl2");
        if (!this.gl) {
            alert("WebGL2 not supported in this browser.");
            return;
        }

        this.colormapType = "turbo";
        this.overlayEnabled = false;
        this.overlayAlpha = 0.28; // overlay transparency
        this.nx = 256;
        this.ny = 256;

        this._init();
    }

    // 🔧 Initialize WebGL program and buffers
    _init() {
        const gl = this.gl;

        const vsSource = `#version 300 es
      precision mediump float;
      in vec2 aPos;
      out vec2 vUV;
      void main() {
        vUV = (aPos + 1.0) * 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

        // 🧠 Fragment Shader: supports multiple colormaps + velocity overlay
        const fsSource = `#version 300 es
      precision highp float;
      uniform sampler2D uTex;
      uniform sampler2D uOverlay;
      uniform bool uOverlayEnabled;
      uniform float uOverlayAlpha;
      uniform int uColormap;
      in vec2 vUV;
      out vec4 fragColor;

      vec3 turbo(float t) {
        vec3 c0 = vec3(0.135, 0.012, 0.548);
        vec3 c1 = vec3(0.423, 0.469, 1.000);
        vec3 c2 = vec3(1.000, 0.815, 0.200);
        vec3 c3 = vec3(0.706, 0.016, 0.150);
        if (t < 0.25) return mix(c0, c1, t / 0.25);
        else if (t < 0.75) return mix(c1, c2, (t - 0.25) / 0.5);
        else return mix(c2, c3, (t - 0.75) / 0.25);
      }

      vec3 seismic(float t) {
        float r = t < 0.5 ? 0.0 : 2.0 * (t - 0.5);
        float b = t > 0.5 ? 0.0 : 2.0 * (0.5 - t);
        float g = 1.0 - abs(t - 0.5) * 2.0;
        return vec3(r, g, b);
      }

      vec3 velocity(float t) {
        if (t < 0.5) return vec3(t * 2.0, t * 1.2, 1.0);
        return vec3(1.0, (1.0 - t) * 1.2, 0.5 * (1.0 - t));
      }

      vec3 overlayVelocity(float t) {
        // Green = low, Red = high
        return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), t);
      }

      void main() {
        float val = texture(uTex, vUV).r;
        val = clamp(val, 0.0, 1.0);

        vec3 baseColor;
        if (uColormap == 0) baseColor = turbo(val);
        else if (uColormap == 1) baseColor = seismic(val);
        else baseColor = velocity(val);

        if (uOverlayEnabled) {
          float overlayVal = texture(uOverlay, vUV).r;
          vec3 overlayColor = overlayVelocity(overlayVal);
          baseColor = mix(baseColor, overlayColor, uOverlayAlpha);
        }

        fragColor = vec4(baseColor, 1.0);
      }
    `;

        this.program = this._createProgram(vsSource, fsSource);
        gl.useProgram(this.program);

        const vertices = new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]);

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const aPosLoc = gl.getAttribLocation(this.program, "aPos");
        gl.enableVertexAttribArray(aPosLoc);
        gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

        this.vao = vao;

        // 🧩 Frame and overlay textures
        this.frameTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.overlayTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.uTex = gl.getUniformLocation(this.program, "uTex");
        this.uOverlay = gl.getUniformLocation(this.program, "uOverlay");
        this.uOverlayEnabled = gl.getUniformLocation(this.program, "uOverlayEnabled");
        this.uOverlayAlpha = gl.getUniformLocation(this.program, "uOverlayAlpha");
        this.uColormap = gl.getUniformLocation(this.program, "uColormap");

        console.log("🖥 WebGL Renderer initialized with overlay support");
    }

    _createShader(type, src) {
        const gl = this.gl;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            console.error(gl.getShaderInfoLog(s));
        return s;
    }

    _createProgram(vsSrc, fsSrc) {
        const gl = this.gl;
        const vs = this._createShader(gl.VERTEX_SHADER, vsSrc);
        const fs = this._createShader(gl.FRAGMENT_SHADER, fsSrc);
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            console.error(gl.getProgramInfoLog(p));
        return p;
    }

    setColormap(type) {
        if (["turbo", "seismic", "velocity"].includes(type)) {
            this.colormapType = type;
            console.log(`🎨 Colormap switched to ${type}`);
        }
    }

    setOverlayEnabled(state) {
        this.overlayEnabled = state;
        console.log(`🧭 Overlay ${state ? "enabled" : "disabled"}`);
    }

    // 🔁 Uploads new frame + optional velocity overlay texture
    update(data, nx, ny, overlayData = null) {
        const gl = this.gl;
        this.nx = nx; this.ny = ny;

        // Normalize simulation data
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        const scale = 1 / (max - min + 1e-6);
        const normData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) normData[i] = (data[i] - min) * scale;

        gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, normData);

        if (overlayData) {
            gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, nx, ny, 0, gl.RED, gl.FLOAT, overlayData);
        }

        this.render();
    }

    // 🖼 Draws to screen
    render() {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        const mapIndex =
            this.colormapType === "turbo" ? 0 :
                this.colormapType === "seismic" ? 1 : 2;

        gl.uniform1i(this.uColormap, mapIndex);
        gl.uniform1i(this.uOverlayEnabled, this.overlayEnabled);
        gl.uniform1f(this.uOverlayAlpha, this.overlayAlpha);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
        gl.uniform1i(this.uTex, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
        gl.uniform1i(this.uOverlay, 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}

window.RendererGL = RendererGL;
