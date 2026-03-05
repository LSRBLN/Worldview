/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_GOOGLE_MAP_TILES_KEY?: string;
  readonly VITE_ADSB_FALLBACK_URL?: string;
  readonly VITE_AIS_WS_URL?: string;
  readonly VITE_AISSTREAM_API_KEY?: string;
  readonly VITE_AIS_WS_API_KEY?: string;
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // OpenSky Credentials für Basic Auth (höheres Rate-Limit)
  readonly VITE_OPENSKY_USERNAME?: string;
  readonly VITE_OPENSKY_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
