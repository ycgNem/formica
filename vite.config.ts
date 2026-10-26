import { defineConfig } from 'vite';

// Relative asset paths, so the build runs from any folder: an itch.io upload, a zip, or a desktop wrapper
export default defineConfig({
  base: './',
});
