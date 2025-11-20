@echo off
echo 
echo Building quake_cuda_stream.exe...
echo
nvcc -arch=sm_86 -O3 -use_fast_math -lineinfo -o quake_cuda_stream.exe quake_cuda_cpml.cu
echo
echo Build complete.
pause