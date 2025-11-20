// colormap.js - Unified Color Mapping Library
// Provides Turbo, Seismic, and Velocity colormaps for visualization

// --- Turbo Colormap ---
function colormapTurbo(x) {
    x = Math.min(Math.max(x, 0.0), 1.0);
    const c0 = [0.135, 0.012, 0.548];
    const c1 = [0.423, 0.469, 1.000];
    const c2 = [1.000, 0.815, 0.200];
    const c3 = [0.706, 0.016, 0.150];
    if (x < 0.25) return mixColors(c0, c1, x / 0.25);
    else if (x < 0.75) return mixColors(c1, c2, (x - 0.25) / 0.5);
    else return mixColors(c2, c3, (x - 0.75) / 0.25);
}

// --- Seismic Colormap ---
function colormapSeismic(x) {
    x = Math.min(Math.max(x, 0.0), 1.0);
    const r = x < 0.5 ? 0.0 : 2.0 * (x - 0.5);
    const b = x > 0.5 ? 0.0 : 2.0 * (0.5 - x);
    const g = 1.0 - Math.abs(x - 0.5) * 2.0;
    return [r, g, b];
}

// --- Velocity Gradient Colormap (for material visualization) ---
function colormapVelocity(x) {
    x = Math.min(Math.max(x, 0.0), 1.0);
    if (x < 0.5) return [x * 2.0, x * 1.2, 1.0];
    return [1.0, (1.0 - x) * 1.2, 0.5 * (1.0 - x)];
}

// --- Helper to mix two colors ---
function mixColors(a, b, t) {
    return [
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t
    ];
}

// --- Draw colorbar for UI ---
function drawColorbar(canvas, colormap) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) {
        const v = 1 - j / h;
        const [r, g, b] = colormap(v);
        for (let i = 0; i < w; i++) {
            const k = (j * w + i) * 4;
            img.data[k] = r * 255;
            img.data[k + 1] = g * 255;
            img.data[k + 2] = b * 255;
            img.data[k + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

// --- Export for global usage ---
window.ColorMaps = {
    turbo: colormapTurbo,
    seismic: colormapSeismic,
    velocity: colormapVelocity,
    drawColorbar
};
