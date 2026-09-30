import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Relative paths, so the build works at geremyrobinson.github.io/Index/ and from any folder.
export default defineConfig({
  base: "./",
  plugins: [preact()],
  build: { target: "es2020", modulePreload: { polyfill: false } },
});
