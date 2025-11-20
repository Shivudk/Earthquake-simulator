import { spawn } from "child_process";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "../public")));
const ENGINE_PATH = path.join(__dirname, "../engine/quake_cuda_stream.exe");

server.listen(8080, "0.0.0.0", () => {
    console.log("✅ Server running at http://localhost:8080");
});

wss.on("connection", (ws) => {
    console.log("🌐 WebSocket connected");

    // --- State for this specific client ---
    ws.engineProc = null;
    ws.stdoutBuffer = Buffer.alloc(0); // For binary frames
    ws.stderrBuffer = "";              // For text analytics
    ws.frameSize = 0;                  // in bytes

    ws.on("message", (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === "start") startEngine(ws, data.cfg);
            else if (data.type === "stop") stopEngine(ws);
        } catch (e) {
            console.error("Failed to parse ws message", e);
        }
    });

    ws.on("close", () => {
        console.log("🌐 WebSocket disconnected");
        stopEngine(ws); // Stop the engine when the client disconnects
    });
});

function startEngine(ws, cfg) {
    stopEngine(ws); // Stop any existing engine for this client

    // Reset buffer state
    ws.stdoutBuffer = Buffer.alloc(0);
    ws.stderrBuffer = "";
    ws.frameSize = 0;

    const args = [
        "--nx", cfg.nx,
        "--ny", cfg.ny,
        "--dx", cfg.dx,
        "--dt", cfg.dt,
        "--steps", 1000000000,
        "--frames_every", 60,
        "--pml", cfg.sponge,
        "--c0", cfg.c0,
        "--amp", cfg.amp,
        "--f0", cfg.f0,
        "--model", cfg.model
    ];

    // --- Add custom source location if provided ---
    if (cfg.sx !== undefined && cfg.sy !== undefined) {
        args.push("--sx", cfg.sx.toString());
        args.push("--sy", cfg.sy.toString());
    }

    console.log("🚀 Launching engine:", ENGINE_PATH, args.join(" "));

    // [FIXED] Run engine in its own directory so it finds DLLs/files
    const engineProc = spawn(ENGINE_PATH, args, { 
        windowsHide: true,
        cwd: path.dirname(ENGINE_PATH) 
    });
    ws.engineProc = engineProc; 

    // --- Handle Engine Output (stderr) ---
    engineProc.stderr.on("data", (data) => {
        const textChunk = data.toString();
        ws.stderrBuffer += textChunk;

        // [FIXED] Print engine errors to the console so you can see them
        process.stdout.write(textChunk);

        // Process all complete lines in the buffer
        let newlineIndex;
        while ((newlineIndex = ws.stderrBuffer.indexOf('\n')) >= 0) {
            const msg = ws.stderrBuffer.substring(0, newlineIndex).trim();
            ws.stderrBuffer = ws.stderrBuffer.substring(newlineIndex + 1); 

            if (msg === "") continue;

            const header = msg.match(/HEADER nx=(\d+) ny=(\d+)/);
            const perf = msg.match(/PERF step_ms_avg=([\d.-]+)/);
            const energy = msg.match(/ENERGY val=([\d.eE+-]+)/);

            try {
                if (header) {
                    const nx = +header[1];
                    const ny = +header[2];
                    ws.frameSize = nx * ny * 4; // (nx * ny * sizeof(float))
                    ws.send(JSON.stringify({ type: "meta", nx: nx, ny: ny }));
                } else if (perf) {
                    ws.send(JSON.stringify({ type: "analytics", key: "gpu", value: parseFloat(perf[1]).toFixed(3) }));
                } else if (energy) {
                    ws.send(JSON.stringify({ type: "analytics", key: "energy", value: parseFloat(energy[1]).toExponential(3) }));
                }
            } catch (ws_err) {
                console.error("Failed to send WS message", ws_err);
            }
        }
    });

    // --- Handle Engine Data (stdout) ---
    engineProc.stdout.on("data", (chunk) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.stdoutBuffer = Buffer.concat([ws.stdoutBuffer, chunk]);
        if (ws.frameSize === 0) return; // Wait for header
        while (ws.stdoutBuffer.length >= ws.frameSize) {
            const frame = ws.stdoutBuffer.subarray(0, ws.frameSize);
            ws.send(frame);
            ws.stdoutBuffer = ws.stdoutBuffer.subarray(ws.frameSize);
        }
    });

    engineProc.on("exit", (code) => {
        console.log("🛑 Engine exited with code", code);
        if (ws.engineProc === engineProc) {
            ws.engineProc = null;
        }
    });
}

function stopEngine(ws) {
    if (ws.engineProc) {
        ws.engineProc.kill();
        ws.engineProc = null;
        console.log("🛑 Engine stopped for client");
    }
    ws.stdoutBuffer = Buffer.alloc(0);
    ws.stderrBuffer = "";
    ws.frameSize = 0;
}