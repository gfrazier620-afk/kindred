import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/<repo>/ without
// knowing the repo name ahead of time.
export default defineConfig({
  base: './',
});
