import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Served at https://abrahamyeung.com/paper-reader/
// (GitHub Pages project repo named "paper-reader" under your custom domain).
const BASE = "/paper-reader/";

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "The Daily Drop — Paper Reader",
        short_name: "Daily Drop",
        description:
          "A daily paper-reading habit: one drop a day, a 5-minute timer, and a streak.",
        theme_color: "#c1432a",
        background_color: "#f4f1ea",
        display: "standalone",
        orientation: "portrait",
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
