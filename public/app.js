// app.js - Client-side application logic with Frame Queueing

document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Get DOM Elements ---
    const canvas = document.getElementById("view");
    const statusText = document.getElementById("statusText");
    const statusLight = document.querySelector("#status span");
    const startBtn = document.getElementById("start");
    const stopBtn = document.getElementById("stop");
    const colormapSelect = document.getElementById("colormap");
    const overlayCheck = document.getElementById("overlay");
    const loader = document.getElementById("loader");

    // Analytics displays
    const fpsInput = document.getElementById("fps");
    const gpuInput = document.getElementById("gpu");
    const energyInput = document.getElementById("energy");
    const peakInput = document.getElementById("peak");
    const fpsLabel = document.getElementById("fpsLabel");
    const gpuLabel = document.getElementById("gpuLabel");
    const energyLabel = document.getElementById("energyLabel");

    const colorbarCanvas = document.getElementById("colorbar-canvas");
    const energyChartCanvas = document.getElementById("energyChart");
    const chartCtx = energyChartCanvas.getContext("2d");

    // --- 2. Initialize Renderer ---
    let renderer;
    try {
        loader.style.display = "block";
        renderer = new window.RendererGL(canvas);
        loader.style.display = "none";
    } catch (e) {
        console.error("Failed to initialize WebGL Renderer:", e);
        loader.innerText = "Error: WebGL2 not supported.";
        return;
    }

    // --- 3. State Variables ---
    let ws = null;
    let simNx = 800; // Updated default
    let simNy = 800;
    
    // FRAME QUEUE VARIABLES
    let frameQueue = [];
    let isPlaying = false;
    let lastRenderTime = 0;

    // Energy Chart State
    let energyHistory = [];
    const MAX_HISTORY = 200;

    // --- 4. WebSocket Connection ---
    function connect() {
        const wsUrl = `ws://${window.location.host}`;
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
            console.log("WebSocket connected");
            statusText.textContent = "connected";
            statusLight.style.background = "#44ff44";
        };

        ws.onclose = () => {
            console.log("WebSocket disconnected");
            statusText.textContent = "disconnected";
            statusLight.style.background = "#ff4444";
            updateAnalytics("fps", "---");
            updateAnalytics("gpu", "---");
            updateAnalytics("energy", "---");
            updateAnalytics("peak", "---");
            resetEnergyChart();
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            statusText.textContent = "error";
        };

        ws.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer) {
                // --- Binary Frame Received: PUSH TO QUEUE ---
                // We do not render here immediately. We store it.
                const frame = new Float32Array(e.data);
                frameQueue.push(frame);
            } else {
                // --- JSON Message Received ---
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === "meta") {
                        console.log("Received metadata:", msg);
                        simNx = msg.nx;
                        simNy = msg.ny;
                        canvas.width = msg.nx;
                        canvas.height = msg.ny;
                        // Clear queue on new start
                        frameQueue = [];
                    } else if (msg.type === "analytics") {
                        updateAnalytics(msg.key, msg.value);
                        if (msg.key === "energy") {
                            updateEnergyChart(parseFloat(msg.value));
                        }
                    }
                } catch (err) {
                    console.warn("Received non-JSON message:", e.data);
                }
            }
        };
    }

    // --- 5. Render Loop (The "Player") ---
    function animationLoop(timestamp) {
        if (!isPlaying) {
            requestAnimationFrame(animationLoop);
            return;
        }

        // Play back frames if available
        if (frameQueue.length > 0) {
            const frame = frameQueue.shift(); // Get oldest frame
            
            // Update peak amp logic
            let peakAmp = 0;
            for (let i = 0; i < frame.length; i+=10) { // Sample every 10th for speed
                const amp = Math.abs(frame[i]);
                if (amp > peakAmp) peakAmp = amp;
            }
            updateAnalytics("peak", peakAmp.toFixed(4));

            // Send to GPU
            renderer.update(frame, simNx, simNy);

            // Calculate Client FPS
            const dt = timestamp - lastRenderTime;
            if (dt > 500) { // Update FPS every 500ms
                const fps = 1000 / dt;
                // Only show reasonable FPS
                if (fps < 200) updateAnalytics("fps", fps.toFixed(1));
                lastRenderTime = timestamp;
            }
        }

        requestAnimationFrame(animationLoop);
    }

    // Start the loop immediately
    isPlaying = true;
    requestAnimationFrame(animationLoop);


    // --- 6. UI Event Listeners ---
    startBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            resetEnergyChart();
            frameQueue = []; // Clear old frames
            
            const cfg = {
                nx: +document.getElementById("nx").value,
                ny: +document.getElementById("ny").value,
                dt: +document.getElementById("dt").value,
                dx: +document.getElementById("dx").value,
                c0: +document.getElementById("c0").value,
                f0: +document.getElementById("f0").value,
                sponge: +document.getElementById("sponge").value,
                amp: +document.getElementById("amp").value,
                model: document.getElementById("model").value
            };
            console.log("Sending 'start' with config:", cfg);
            ws.send(JSON.stringify({ type: "start", cfg: cfg }));
        } else {
            console.log("WebSocket not open. Reconnecting...");
            connect();
        }
    };

    stopBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log("Sending 'stop'");
            ws.send(JSON.stringify({ type: "stop" }));
            frameQueue = [];
            resetEnergyChart();
        }
    };

    colormapSelect.onchange = () => {
        const mapType = colormapSelect.value;
        renderer.setColormap(mapType);
        updateColorbar(mapType);
        renderer.render();
    };

    overlayCheck.onchange = () => {
        const enabled = overlayCheck.checked;
        renderer.setOverlayEnabled(enabled);
        renderer.render();
    };

    // --- 7. Helper Functions ---
    function updateAnalytics(key, value) {
        if (key === "fps") {
            fpsInput.value = value;
            fpsLabel.innerText = value;
        } else if (key === "gpu") {
            gpuInput.value = value;
            gpuLabel.innerText = value + " ms";
        } else if (key === "energy") {
            energyInput.value = value;
            energyLabel.innerText = value;
        } else if (key === "peak") {
            peakInput.value = value;
        }
    }

    function updateColorbar(mapType) {
        if (!colorbarCanvas || !window.ColorMaps[mapType]) return;
        window.ColorMaps.drawColorbar(
            colorbarCanvas,
            window.ColorMaps[mapType]
        );
    }

    // --- Energy Chart Drawing Functions ---
    function updateEnergyChart(newValue) {
        energyHistory.push(newValue);
        if (energyHistory.length > MAX_HISTORY) {
            energyHistory.shift();
        }
        drawEnergyChart();
    }

    function resetEnergyChart() {
        energyHistory = [];
        chartCtx.clearRect(0, 0, energyChartCanvas.width, energyChartCanvas.height);
    }

    function drawEnergyChart() {
        const w = energyChartCanvas.width;
        const h = energyChartCanvas.height;

        let maxEnergy = 0;
        for (const val of energyHistory) {
            if (val > maxEnergy) maxEnergy = val;
        }
        if (maxEnergy === 0) maxEnergy = 1;

        chartCtx.clearRect(0, 0, w, h);

        chartCtx.beginPath();
        chartCtx.strokeStyle = "rgba(0, 255, 242, 0.8)";
        chartCtx.lineWidth = 1.5;

        for (let i = 0; i < energyHistory.length; i++) {
            const x = (i / (MAX_HISTORY - 1)) * w;
            const y = h - (energyHistory[i] / maxEnergy) * h;

            if (i === 0) {
                chartCtx.moveTo(x, y);
            } else {
                chartCtx.lineTo(x, y);
            }
        }
        chartCtx.stroke();
    }

    // --- 8. Initial Run ---
    connect();
    // Ensure renderer knows the initial colormap
    if (renderer) renderer.setColormap(colormapSelect.value);
    updateColorbar(colormapSelect.value);
    resetEnergyChart();
});