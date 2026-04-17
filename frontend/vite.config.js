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
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        secure: false,
      },
      "/search": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        secure: false,
      },
      "/satellite": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        secure: false,
      },
      "/observer": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        secure: false,
      },
    },
  },
});
