import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://satellite-tracker-api.onrender.com",
        changeOrigin: true,
        secure: true,
      },
      "/search": {
        target: "https://satellite-tracker-api.onrender.com",
        changeOrigin: true,
        secure: true,
      },
      "/satellite": {
        target: "https://satellite-tracker-api.onrender.com",
        changeOrigin: true,
        secure: true,
      },
      "/observer": {
        target: "https://satellite-tracker-api.onrender.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
