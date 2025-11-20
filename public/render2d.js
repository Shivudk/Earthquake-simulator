// render2d.js - Enhanced 2D CPU Renderer

window.CanvasRenderer = {
    create2D(canvas) {
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(canvas.width, canvas.height);
        let currentColormap = window.ColorMaps.turbo; // Default

        return {
            setColormap(type) {
                if (window.ColorMaps[type]) {
                    currentColormap = window.ColorMaps[type];
                    console.log(`🎨 Switched to ${type} colormap`);
                } else {
                    console.warn("Unknown colormap type:", type);
                }
            },

            render(field, nx, ny) {
                const img = image.data;
                const sx = canvas.width / nx, sy = canvas.height / ny;

                let minVal = Infinity, maxVal = -Infinity;
                for (let i = 0; i < field.length; ++i) {
                    if (field[i] < minVal) minVal = field[i];
                    if (field[i] > maxVal) maxVal = field[i];
                }
                const range = maxVal - minVal + 1e-6;

                for (let j = 0; j < ny; ++j) {
                    for (let i = 0; i < nx; ++i) {
                        const v = (field[j * nx + i] - minVal) / range;
                        const [r, g, b] = currentColormap(v);
                        const k = (j * nx + i) * 4;
                        img[k] = r * 255;
                        img[k + 1] = g * 255;
                        img[k + 2] = b * 255;
                        img[k + 3] = 255;
                    }
                }
                ctx.putImageData(image, 0, 0);
            }
        };
    }
};
