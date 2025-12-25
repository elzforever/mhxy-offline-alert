import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      // This is crucial: Vite usually uses import.meta.env, but your code uses process.env.
      // We define a replacement here so process.env.API_KEY works in the browser.
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
  }
})