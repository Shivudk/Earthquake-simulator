@echo off
title Earthquake Dashboard Launcher
cd /d "%~dp0"

echo ================================================
echo   BUILDING CUDA ENGINE (quake_cuda_cpml.cu)
echo ================================================
cd engine
if exist quake_cuda_stream.exe del quake_cuda_stream.exe
nvcc -O3 -use_fast_math -lineinfo -o quake_cuda_stream.exe quake_cuda_cpml.cu
if %errorlevel% neq 0 (
    echo.
    echo ❌ BUILD FAILED! Check CUDA setup or nvcc output.
    pause
    exit /b
)
echo ✅ Build complete!

cd ..\server
echo ================================================
echo   STARTING SERVER ON http://localhost:8080
echo ================================================
start "" cmd /c "npm start"
timeout /t 3 >nul

echo ================================================
echo   OPENING BROWSER...
echo ================================================
start "" "http://localhost:8080"
cd ..
echo ✅ Done!
pause
