import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Kostenfrei weil Free-Tier / GitHub Student Pack
// Cesium benötigt statische Assets (Workers, ThirdParty, Assets, Widgets).
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const pagesBase = process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}/` : '/';

export default defineConfig({
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Für GitHub Pages muss der Base-Pfad auf /<repo>/ gesetzt werden.
  base: pagesBase,
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/Workers',
          dest: 'cesium'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/ThirdParty',
          dest: 'cesium'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Assets',
          dest: 'cesium'
        },
        {
          src: 'node_modules/cesium/Build/Cesium/Widgets',
          dest: 'cesium'
        }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  },
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
          satellite: ['satellite.js'],
          three: ['three'],
          gsap: ['gsap']
        }
      }
    }
  }
});
