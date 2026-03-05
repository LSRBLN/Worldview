import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec
} from 'satellite.js';

// Kostenfrei weil Free-Tier / GitHub Student Pack
(window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium';

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
if (ionToken) {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  Cesium.Ion.defaultAccessToken = ionToken;
}

const container = document.getElementById('cesiumContainer');
const statusText = document.getElementById('statusText');
const healthText = document.getElementById('healthText');
const hoverInfo = document.getElementById('hoverInfo') as HTMLDivElement | null;
const entityInfoPanel = document.getElementById('entityInfoPanel') as HTMLDivElement | null;
const pollingIndicator = document.getElementById('pollingIndicator') as HTMLDivElement | null;
const appRoot = document.getElementById('app');
const activeVisionMode = document.getElementById('activeVisionMode');
const recClockText = document.getElementById('recClockText');
const orbText = document.getElementById('orbText');
const passText = document.getElementById('passText');
const clearanceText = document.getElementById('clearanceText');
const apiTilesText = document.getElementById('apiTilesText');
const apiFlightsText = document.getElementById('apiFlightsText');
const apiAisText = document.getElementById('apiAisText');
const incidentFeedList = document.getElementById('incidentFeedList') as HTMLDivElement | null;

// Neue HUD Elemente für STRATONOVA Military Interface
const entityCallsign = document.getElementById('entityCallsign');
const entityType = document.getElementById('entityType');
const entityCoords = document.getElementById('entityCoords');
const entitySpeed = document.getElementById('entitySpeed');
const entityDistance = document.getElementById('entityDistance');
const entityStatus = document.getElementById('entityStatus');
const flightStatus = document.getElementById('flightStatus');
const satStatus = document.getElementById('satStatus');
const aisStatus = document.getElementById('aisStatus');

// Legacy buttons (not in new UI but kept for compatibility)
const exportReplayButton = null;
const fullscreenButton = null;
const militaryInfoPanel = null;

type TilesPathStatus = 'Google Direct' | 'Google Helper' | 'OSM Fallback';
type FlightsFeedStatus = 'Initializing…' | 'OpenSky online' | 'OpenSky fallback' | 'Replay/CZML fallback' | 'Error';
type AisFeedStatus = 'Initializing…' | 'AIS live' | 'AIS fallback' | 'Error';

type RuntimeDiagnosticsState = {
  tilesPath: TilesPathStatus;
  tilesDetail: string;
  flightsFeed: FlightsFeedStatus;
  flightsDetail: string;
  aisFeed: AisFeedStatus;
  aisDetail: string;
};

type PollStatus = {
  flights: string;
  satellites: string;
  ais: string;
  updatedAt: string;
};

type IncidentSeverity = 'INFO' | 'WARN' | 'ALERT';
type IncidentEntry = {
  time: string;
  severity: IncidentSeverity;
  text: string;
};

const planeBlueIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#ffd24a" d="M31 2l6 20 19 7v6l-19-2-2 9 7 8v5l-10-5-10 5v-5l7-8-2-9-19 2v-6l19-7 6-20z"/></svg>`;
const planeRedIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#ff5a5a" d="M31 2l6 20 19 7v6l-19-2-2 9 7 8v5l-10-5-10 5v-5l7-8-2-9-19 2v-6l19-7 6-20z"/></svg>`;
const shipIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#7ee7ff" d="M8 34h48l-5 11-19 9-19-9-5-11zm11-12h26v8H19z"/></svg>`;
const planeBlueIconDataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(planeBlueIconSvg)}`;
const planeRedIconDataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(planeRedIconSvg)}`;
const shipIconDataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(shipIconSvg)}`;

type EntityIntel = {
  callsign: string;
  altitudeM: string;
  status: string;
  layer: string;
  speed: string;
  noradId: string;
  distanceKm: string;
};

const runtimeDiagnostics: RuntimeDiagnosticsState = {
  tilesPath: 'OSM Fallback',
  tilesDetail: 'Initializing tiles path…',
  flightsFeed: 'Initializing…',
  flightsDetail: 'Waiting for first feed polling cycle…',
  aisFeed: 'Initializing…',
  aisDetail: 'AIS layer booting…'
};

const pollStatus: PollStatus = {
  flights: 'init',
  satellites: 'init',
  ais: 'init',
  updatedAt: '—'
};

const incidentFeed: IncidentEntry[] = [];

function triggerHudAlertPulse(severity: IncidentSeverity): void {
  if (!appRoot || severity !== 'ALERT') {
    return;
  }
  appRoot.classList.add('hud-alert');
  window.setTimeout(() => {
    appRoot.classList.remove('hud-alert');
  }, 1300);
}

function renderIncidentFeed(): void {
  if (!incidentFeedList) {
    return;
  }

  if (incidentFeed.length === 0) {
    incidentFeedList.innerHTML = '<p>INIT // Tactical feed online…</p>';
    return;
  }

  incidentFeedList.innerHTML = incidentFeed.map((entry) => {
    return `<p>[${entry.time}] ${entry.severity} // ${entry.text}</p>`;
  }).join('');
}

function pushIncident(text: string, severity: IncidentSeverity = 'INFO'): void {
  const nowEpochMs = Date.now();
  const signature = `${severity}:${text}`;
  if (signature === lastIncidentSignature && nowEpochMs - lastIncidentEpochMs < 18_000) {
    return;
  }

  lastIncidentSignature = signature;
  lastIncidentEpochMs = nowEpochMs;
  const time = new Date().toISOString().slice(11, 19);
  incidentFeed.unshift({ time, severity, text });
  if (incidentFeed.length > 12) {
    incidentFeed.length = 12;
  }
  renderIncidentFeed();
  triggerHudAlertPulse(severity);
}

function ensureRuntimeDiagnosticsHud(): HTMLDivElement {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  // Produktions-Diagnostik sichtbar im HUD (Vercel vs. lokal).
  const existing = document.getElementById('runtimeDiagnosticsHud') as HTMLDivElement | null;
  if (existing) {
    return existing;
  }

  const hud = document.createElement('div');
  hud.id = 'runtimeDiagnosticsHud';
  hud.className = 'runtime-diagnostics-hud';
  document.body.appendChild(hud);
  return hud;
}

function renderRuntimeDiagnosticsHud(): void {
  const hud = ensureRuntimeDiagnosticsHud();
  hud.innerHTML = `
    <div><strong>Tiles:</strong> ${runtimeDiagnostics.tilesPath}</div>
    <div class="runtime-detail">${runtimeDiagnostics.tilesDetail}</div>
    <div><strong>Flights:</strong> ${runtimeDiagnostics.flightsFeed}</div>
    <div class="runtime-detail">${runtimeDiagnostics.flightsDetail}</div>
    <div><strong>AIS:</strong> ${runtimeDiagnostics.aisFeed}</div>
    <div class="runtime-detail">${runtimeDiagnostics.aisDetail}</div>
  `;
}

function updateRuntimeDiagnostics(partial: Partial<RuntimeDiagnosticsState>): void {
  Object.assign(runtimeDiagnostics, partial);
  renderRuntimeDiagnosticsHud();

  if (apiTilesText) {
    apiTilesText.textContent = `Tiles: ${runtimeDiagnostics.tilesPath}`;
  }
  if (apiFlightsText) {
    apiFlightsText.textContent = `Flights: ${runtimeDiagnostics.flightsFeed}`;
  }
  if (apiAisText) {
    apiAisText.textContent = `AIS: ${runtimeDiagnostics.aisFeed}`;
  }

  console.info('[WorldView][RuntimeDiagnostics]', runtimeDiagnostics);
}

function renderPollingIndicator(): void {
  if (!pollingIndicator) {
    return;
  }

  pollingIndicator.textContent = `Polling • Flights: ${pollStatus.flights} • SAT: ${pollStatus.satellites} • AIS: ${pollStatus.ais} • ${pollStatus.updatedAt}`;
  
  // Update individual status elements for new HUD
  if (flightStatus) flightStatus.textContent = pollStatus.flights;
  if (satStatus) satStatus.textContent = pollStatus.satellites;
  if (aisStatus) aisStatus.textContent = pollStatus.ais;
}

function markPollStatus(channel: keyof Omit<PollStatus, 'updatedAt'>, value: string): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  pollStatus[channel] = value;
  pollStatus.updatedAt = new Date().toLocaleTimeString('en-GB', { hour12: false });
  renderPollingIndicator();
}

function initHudTelemetryTicker(): void {
  const update = () => {
    const now = new Date();
    if (recClockText) {
      recClockText.textContent = `REC: ${now.toISOString().slice(11, 19)}Z`;
    }
    if (orbText) {
      const orbitIndex = ((Math.floor(now.getUTCMinutes() / 7) % 5) + 241).toString().padStart(3, '0');
      orbText.textContent = `ORB: LEO-${orbitIndex}`;
    }
    if (passText) {
      const passPhase = ['HOLD', 'TRACK', 'SYNC', 'TASK'][Math.floor(now.getUTCSeconds() / 15) % 4];
      passText.textContent = `PASS: ${passPhase}`;
    }
    if (clearanceText) {
      clearanceText.textContent = 'CLEARANCE: TS/SCI';
    }

  };

  update();
  window.setInterval(update, 1000);
}

function safeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const text = String(value).trim();
  return text.length > 0 ? text : '—';
}

type OpenSkyStateVector = Array<string | number | null>;
type OpenSkyStatesResponse = {
  time?: number;
  states?: OpenSkyStateVector[];
};

type OpenSkyFlightRecord = {
  icao24?: string;
  firstSeen?: number;
  lastSeen?: number;
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
  callsign?: string | null;
};

type OpenSkyTrackResponse = {
  icao24?: string;
  callsign?: string;
  path?: Array<[number, number, number, number, boolean]>;
};

type FlightVisibilityMode = 'all' | 'military' | 'civilian';
type FlightAltitudeBand = 'all' | 'low' | 'mid' | 'high';

type FlightVisibilityState = {
  mode: FlightVisibilityMode;
  altitudeBand: FlightAltitudeBand;
  staleOnly: boolean;
};

type AdsbTrackMeta = {
  key: string;
  entity: Cesium.Entity;
  isMilitary: boolean;
  altitudeM: number;
  lastSeenEpochMs: number;
  positionTrack?: Cesium.SampledPositionProperty;
};

const flightVisibilityState: FlightVisibilityState = {
  mode: 'all',
  altitudeBand: 'all',
  staleOnly: false
};

const adsbTrackRegistry = new Map<string, AdsbTrackMeta>();
const manuallyHiddenEntityIds = new Set<string>();
const adsbTrackStaleThresholdMs = 120_000;
let lastOpenSkyIntelUpdateEpochMs = 0;
let lastIncidentSignature = '';
let lastIncidentEpochMs = 0;

function isAdsbMilitaryTrack(callsign: string): boolean {
  return /MIL|ARMY|NAVY|AIR|RCH|RRR|QID|UAE|IRIAF|F\d{1,2}|USAF|RAF|IAF/i.test(callsign);
}

function normalizeAdsbTrackKey(state: OpenSkyStateVector, index: number): string {
  const icao24 = String(state[0] ?? '').trim().toLowerCase();
  const callsign = String(state[1] ?? '').trim().toUpperCase();
  if (icao24.length > 0) {
    return `adsb-live-${icao24}`;
  }
  if (callsign.length > 0) {
    return `adsb-live-callsign-${callsign}`;
  }
  return `adsb-live-unknown-${index}`;
}

function classifyAltitudeBand(altitudeM: number): FlightAltitudeBand {
  if (altitudeM < 3_000) {
    return 'low';
  }
  if (altitudeM <= 9_000) {
    return 'mid';
  }
  return 'high';
}

function matchesFlightVisibility(meta: AdsbTrackMeta): boolean {
  if (manuallyHiddenEntityIds.has(meta.entity.id as string)) {
    return false;
  }

  if (flightVisibilityState.mode === 'military' && !meta.isMilitary) {
    return false;
  }

  if (flightVisibilityState.mode === 'civilian' && meta.isMilitary) {
    return false;
  }

  if (flightVisibilityState.altitudeBand !== 'all' && classifyAltitudeBand(meta.altitudeM) !== flightVisibilityState.altitudeBand) {
    return false;
  }

  if (flightVisibilityState.staleOnly) {
    const staleAgeMs = Date.now() - meta.lastSeenEpochMs;
    if (staleAgeMs < adsbTrackStaleThresholdMs) {
      return false;
    }
  }

  return true;
}

function applyFlightVisibilityFilters(): void {
  adsbTrackRegistry.forEach((meta) => {
    meta.entity.show = matchesFlightVisibility(meta);
  });
  viewer.scene.requestRender();
}

function showAllObjects(): void {
  manuallyHiddenEntityIds.clear();
  const visited = new Set<Cesium.DataSource>();
  Object.values(layerManager).forEach((source) => {
    if (visited.has(source)) {
      return;
    }
    visited.add(source);
    source.entities.values.forEach((entity) => {
      entity.show = true;
    });
  });
  applyFlightVisibilityFilters();
  setStatus('All objects visible.');
}

function hideAllObjects(): void {
  const visited = new Set<Cesium.DataSource>();
  Object.values(layerManager).forEach((source) => {
    if (visited.has(source)) {
      return;
    }
    visited.add(source);
    source.entities.values.forEach((entity) => {
      entity.show = false;
      manuallyHiddenEntityIds.add(String(entity.id));
    });
  });
  viewer.scene.requestRender();
  setStatus('All objects hidden.');
}

function getOpenSkyAuthHeader(): string | null {
  if (!openSkyUsername || !openSkyPassword) {
    return null;
  }
  return `Basic ${btoa(`${openSkyUsername}:${openSkyPassword}`)}`;
}

async function fetchOpenSkyEndpoint<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${openSkyBaseUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || Number.isNaN(value)) {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  const authHeader = getOpenSkyAuthHeader();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw new Error(`OpenSky ${path} failed: HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const openSkyApi = {
  statesAll: (params: { lamin: number; lomin: number; lamax: number; lomax: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyStatesResponse>('/states/all', params);
  },
  tracksAll: (params: { icao24: string; time: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyTrackResponse>('/tracks/all', params);
  },
  flightsAircraft: (params: { icao24: string; begin: number; end: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyFlightRecord[]>('/flights/aircraft', params);
  },
  flightsAll: (params: { begin: number; end: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyFlightRecord[]>('/flights/all', params);
  },
  flightsArrival: (params: { airport: string; begin: number; end: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyFlightRecord[]>('/flights/arrival', params);
  },
  flightsDeparture: (params: { airport: string; begin: number; end: number }) => {
    return fetchOpenSkyEndpoint<OpenSkyFlightRecord[]>('/flights/departure', params);
  }
};

async function refreshOpenSkyIntelSnapshot(sampleIcao24: string, referenceTimeSec: number): Promise<void> {
  const now = Date.now();
  if (now - lastOpenSkyIntelUpdateEpochMs < 5 * 60 * 1000) {
    return;
  }
  lastOpenSkyIntelUpdateEpochMs = now;

  const begin = referenceTimeSec - 4 * 3600;
  const end = referenceTimeSec;

  try {
    const [track, flights] = await Promise.all([
      openSkyApi.tracksAll({ icao24: sampleIcao24, time: referenceTimeSec }),
      openSkyApi.flightsAircraft({ icao24: sampleIcao24, begin, end })
    ]);

    const trackPoints = track.path?.length ?? 0;
    const flightCount = flights.length;
    updateRuntimeDiagnostics({
      flightsDetail: `OpenSky states/all + tracks/all + flights/aircraft • ${adsbTrackRegistry.size} tracks • intel: ${sampleIcao24} ${trackPoints} pts/${flightCount} flights`
    });
  } catch (error) {
    console.debug('[WorldView][OpenSky] Intel snapshot unavailable', error);
  }
}

function getDistanceToCameraKm(entity: Cesium.Entity): string {
  const positionProperty = entity.position;
  if (!positionProperty) {
    return '—';
  }

  const entityPos = positionProperty.getValue(viewer.clock.currentTime);
  if (!entityPos) {
    return '—';
  }

  const distanceM = Cesium.Cartesian3.distance(viewer.camera.positionWC, entityPos);
  if (!Number.isFinite(distanceM)) {
    return '—';
  }
  return `${(distanceM / 1000).toFixed(1)} km`;
}

console.info('[WorldView][Boot] DOM-Referenzen', {
  hasContainer: Boolean(container),
  hasStatusText: Boolean(statusText),
  hasHealthText: Boolean(healthText),
  hasExportReplayButton: Boolean(exportReplayButton)
});

if (!container) {
  throw new Error('cesiumContainer wurde nicht gefunden.');
}

console.info('[WorldView][Boot] Container-Größe beim Start', {
  width: container.clientWidth,
  height: container.clientHeight
});

const googleMapTilesKey = (import.meta.env.VITE_GOOGLE_MAP_TILES_KEY as string | undefined)?.trim();
const arcgisApiKey = (import.meta.env.VITE_ARCGIS_API_KEY as string | undefined)?.trim();
const arcgisBasemapStyle = (import.meta.env.VITE_ARCGIS_BASEMAP_STYLE as string | undefined)?.trim() || 'arcgis/light-gray';
const openSkyBaseUrl = ((import.meta.env.VITE_OPENSKY_BASE_URL as string | undefined)?.trim() || 'https://opensky-network.org/api');
const openSkyUsername = (import.meta.env.VITE_OPENSKY_USERNAME as string | undefined)?.trim();
const openSkyPassword = (import.meta.env.VITE_OPENSKY_PASSWORD as string | undefined)?.trim();
const aisWebSocketUrl = ((import.meta.env.VITE_AIS_WS_URL as string | undefined)?.trim() || 'wss://stream.aisstream.io/v0/stream');
const aisWebSocketApiKey = (
  (import.meta.env.VITE_AISSTREAM_API_KEY as string | undefined)?.trim()
  || (import.meta.env.VITE_AIS_WS_API_KEY as string | undefined)?.trim()
);
const aisDefaultBoundingBoxes: [[[number, number], [number, number]]] = [
  // Kostenfrei weil Free-Tier / GitHub Student Pack:
  // bewusst kleines AOI statt globalem Stream, um Bandbreite/Rate-Limits zu schonen.
  [[24.0, 53.5], [28.5, 58.5]]
];
const aisMessageTypes = [1, 2, 3] as const;
const aisUpdateThrottleMs = 5_000;
const aisStaleAfterMs = 30 * 60 * 1000;
const aisSilenceThresholdMs = 90 * 1000;
const aisReconnectBaseDelayMs = 1_000;
const aisReconnectMaxDelayMs = 60_000;
const aisReconnectJitterMs = 900;
const aisReconnectMaxAttempts = 8;
console.info('[WorldView][Env][Prod-Diagnose]', {
  mode: import.meta.env.MODE,
  prod: import.meta.env.PROD,
  hasGoogleMapTilesKey: Boolean(googleMapTilesKey),
  googleMapTilesKeyLength: googleMapTilesKey?.length ?? 0,
  hasAisWebSocketUrl: Boolean(aisWebSocketUrl),
  hasAisWebSocketApiKey: Boolean(aisWebSocketApiKey)
});

function setStatus(message: string): void {
  if (statusText) {
    statusText.textContent = message;
    statusText.classList.remove('status-typewriter');
    void statusText.offsetWidth;
    statusText.classList.add('status-typewriter');
  }
}

function setHealth(message: string): void {
  if (healthText) {
    healthText.textContent = message;
    healthText.classList.remove('status-typewriter');
    void healthText.offsetWidth;
    healthText.classList.add('status-typewriter');
  }
}

function setHudModeClass(mode: ShaderMode): void {
  if (!appRoot) {
    return;
  }

  appRoot.classList.remove('mode-eo', 'mode-nvg', 'mode-flir');
  if (mode === 'nvg') {
    appRoot.classList.add('mode-nvg');
    if (activeVisionMode) {
      activeVisionMode.textContent = 'VISION: NVG';
    }
    return;
  }
  if (mode === 'flir') {
    appRoot.classList.add('mode-flir');
    if (activeVisionMode) {
      activeVisionMode.textContent = 'VISION: FLIR';
    }
    return;
  }
  appRoot.classList.add('mode-eo');
  if (activeVisionMode) {
    activeVisionMode.textContent = mode === 'crt' ? 'VISION: EO-CRT' : 'VISION: EO';
  }
}

type CameraPresetKey = 'hormuz' | 'iran' | 'tehran' | 'natanz';
type ShaderMode = 'none' | 'crt' | 'nvg' | 'flir';

const cameraPresets: Record<CameraPresetKey, { lon: number; lat: number; height: number; heading: number; pitch: number }> = {
  hormuz: { lon: 56.2, lat: 26.1, height: 950000, heading: 5, pitch: -45 },
  iran: { lon: 53.7, lat: 32.0, height: 1750000, heading: 0, pitch: -60 },
  tehran: { lon: 51.389, lat: 35.6892, height: 180000, heading: 20, pitch: -50 },
  natanz: { lon: 51.723, lat: 33.724, height: 160000, heading: 10, pitch: -55 }
};

const viewer = new Cesium.Viewer(container, {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  baseLayerPicker: false,
  geocoder: false,
  homeButton: true,
  navigationHelpButton: false,
  animation: true,
  timeline: true,
  sceneModePicker: false,
  selectionIndicator: false,
  infoBox: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
  targetFrameRate: 30, // Performance: 30 FPS statt unbegrenzt
  useBrowserRecommendedResolution: false, // Volle Auflösung
  scene3DOnly: true, // Performance: Nur 3D, keine 2D/2.5D
  orderIndependentTranslucency: false // Performance: Bessere Performance bei Transparenz
});

// Performance-Optimierungen für die Scene
viewer.scene.fog.enabled = false; // Performance: Nebel deaktiviert
viewer.scene.globe.depthTestAgainstTerrain = false; // Performance: Kein Depth Testing
viewer.scene.globe.maximumScreenSpaceError = 2; // Performance: Niedrigere Detailstufe

// Frame-Rate-Limitierung für Batterie-Schonung
viewer.targetFrameRate = 30;

const pointerHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

function readEntityPosition(entity: Cesium.Entity): Cesium.Cartographic | null {
  const positionProperty = entity.position;
  if (!positionProperty) {
    return null;
  }

  const position = positionProperty.getValue(viewer.clock.currentTime);
  if (!position) {
    return null;
  }

  return Cesium.Cartographic.fromCartesian(position);
}

function extractEntityMeta(entity: Cesium.Entity): EntityIntel {
  const cartographic = readEntityPosition(entity);
  const altitudeM = cartographic ? `${Math.max(0, cartographic.height).toFixed(0)} m` : '—';
  const id = safeText(entity.id);
  const name = safeText(entity.name);
  const propertyBag = entity.properties as Cesium.PropertyBag | undefined;
  const properties = propertyBag?.getValue(viewer.clock.currentTime) as Record<string, unknown> | undefined;
  const callsignValue = properties?.callsign;
  const jammingValue = properties?.gpsJamming;
  const speedRaw = Number(properties?.speedKts ?? properties?.speed ?? NaN);
  const noradRaw = properties?.noradId;
  const callsign = safeText(callsignValue ?? (name !== '—' ? name : id));
  const status = jammingValue === true ? 'Jamming Detected' : 'Tracking';
  const speed = Number.isFinite(speedRaw) ? `${speedRaw.toFixed(0)} kts` : '—';
  const noradId = safeText(noradRaw);
  const distanceKm = getDistanceToCameraKm(entity);

  let layer = 'Unknown';
  if (id.includes('adsb') || id.includes('flight') || id.includes('iran-flight')) {
    layer = 'OpenSky';
  } else if (id.includes('sat')) {
    layer = 'Satellite';
  } else if (id.includes('ais')) {
    layer = 'AIS';
  } else if (id.includes('jamming')) {
    layer = 'Jamming Zone';
  } else if (id.includes('no-fly')) {
    layer = 'No-Fly Zone';
  }

  return { callsign, altitudeM, status, layer, speed, noradId, distanceKm };
}

function formatEntityCoordinates(entity: Cesium.Entity): string {
  const cartographic = readEntityPosition(entity);
  if (!cartographic) {
    return '—';
  }

  const lat = Cesium.Math.toDegrees(cartographic.latitude);
  const lon = Cesium.Math.toDegrees(cartographic.longitude);
  return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
}

function classifyEntityType(entity: Cesium.Entity): string {
  if (entity.billboard) {
    return 'Air / Surface Track';
  }
  if (entity.point && entity.path) {
    return 'Satellite';
  }
  if (entity.polygon) {
    return 'Zone';
  }
  if (entity.model) {
    return 'Aircraft Model';
  }
  return 'Unknown';
}

function renderEntityInfoPanel(entity: Cesium.Entity | null): void {
  // Neue Entity Info Funktion für STRATONAVA HUD - verwendet DOM Elemente statt innerHTML
  if (!entity) {
    // Reset to default values
    if (entityCallsign) entityCallsign.textContent = '—';
    if (entityType) entityType.textContent = '—';
    if (entityCoords) entityCoords.textContent = '—';
    if (entitySpeed) entitySpeed.textContent = '—';
    if (entityDistance) entityDistance.textContent = '—';
    if (entityStatus) {
      entityStatus.textContent = 'Standby';
      entityStatus.className = 'intel-value status-standby';
    }
    
    // Update hide button
    const hideButton = document.getElementById('hideEntityButton') as HTMLButtonElement | null;
    if (hideButton) {
      hideButton.dataset.entityId = '';
    }
    return;
  }

  const meta = extractEntityMeta(entity);
  const coords = formatEntityCoordinates(entity);
  const type = classifyEntityType(entity);
  const entityId = safeText(entity.id);
  
  // Update DOM elements directly
  if (entityCallsign) entityCallsign.textContent = meta.callsign;
  if (entityType) entityType.textContent = `${type} (${meta.layer})`;
  if (entityCoords) entityCoords.textContent = coords;
  if (entitySpeed) entitySpeed.textContent = meta.speed;
  if (entityDistance) entityDistance.textContent = meta.distanceKm;
  if (entityStatus) {
    entityStatus.textContent = `${meta.status} • ALT ${meta.altitudeM}`;
    entityStatus.className = 'intel-value status-active';
  }
  
  // Update hide button
  const hideButton = document.getElementById('hideEntityButton') as HTMLButtonElement | null;
  if (hideButton) {
    hideButton.dataset.entityId = entityId;
  }
}

function renderMilitaryInfoPanel(_entries: Array<{ callsign: string; altitude: string; speed: string; source: string }>): void {
  // Military info panel removed in new HUD design - functionality merged into incident feed
}

function bindHideEntityAction(): void {
  const localHideButton = document.getElementById('hideEntityButton') as HTMLButtonElement | null;
  if (!localHideButton) {
    return;
  }

  localHideButton.addEventListener('click', () => {
    const entityId = localHideButton.dataset.entityId;
    if (!entityId) {
      renderEntityInfoPanel(null);
      return;
    }

    const target = viewer.entities.getById(entityId)
      ?? layerCollections.adsb.entities.getById(entityId)
      ?? layerCollections.satellites.entities.getById(entityId)
      ?? layerCollections.ais.entities.getById(entityId)
      ?? layerCollections.jamming.entities.getById(entityId)
      ?? layerCollections.noFlyZones.entities.getById(entityId)
      ?? replaySources.adsb.entities.getById(entityId)
      ?? replaySources.satellites.entities.getById(entityId);

    if (!target) {
      renderEntityInfoPanel(null);
      return;
    }

    target.show = false;
    manuallyHiddenEntityIds.add(String(target.id));
    viewer.selectedEntity = undefined;
    renderEntityInfoPanel(null);
    setStatus(`Entity hidden: ${safeText(target.name ?? target.id)}`);
    viewer.scene.requestRender();
  });
}

function updateHoverInfo(x: number, y: number): void {
  if (!hoverInfo) {
    return;
  }

  const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
  if (!Cesium.defined(picked) || !(picked as { id?: unknown }).id) {
    hoverInfo.style.display = 'none';
    hoverInfo.setAttribute('aria-hidden', 'true');
    return;
  }

  const entity = (picked as { id: Cesium.Entity }).id;
  const meta = extractEntityMeta(entity);
  const coords = formatEntityCoordinates(entity);
  hoverInfo.style.display = 'block';
  hoverInfo.setAttribute('aria-hidden', 'false');
  hoverInfo.style.left = `${x + 14}px`;
  hoverInfo.style.top = `${y + 14}px`;
  hoverInfo.innerHTML = `<strong>${meta.callsign}</strong><br/>Alt: ${meta.altitudeM}<br/>Spd: ${meta.speed}<br/>Dst: ${meta.distanceKm}<br/>${coords}<br/>${meta.status}`;
}

let activeFallbackImageryLayer: Cesium.ImageryLayer | null = null;

function setSceneGlobeVisibility(show: boolean, context: string): void {
  const globe = viewer.scene.globe;
  if (!globe) {
    console.warn('[WorldView][Guard] scene.globe ist undefined, show-Update übersprungen', {
      context,
      requestedShow: show
    });
    return;
  }

  globe.show = show;
}

function ensureVisibleFreeTierGlobeFallback(reason: string): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  // Robuster kostenfreier Fallback: Globe + OSM-Imagery sichtbar, auch wenn Google Tiles fehlschlagen.
  console.warn('[WorldView][Fallback] Aktiviere Globe/OSM Fallback', {
    reason,
    imageryLayerCountBefore: viewer.imageryLayers.length,
    globeVisibleBefore: viewer.scene.globe?.show
  });

  setSceneGlobeVisibility(true, 'ensureVisibleFreeTierGlobeFallback');
  if (viewer.scene.globe) {
    viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  }

  // God’s Eye Original-Look – Bilawal-Video March 2026
  // Keine Paid-API: Ellipsoid-Terrain + ArcGIS/OSM-Imagery als garantiert sichtbarer Fallback.
  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();

  try {
    viewer.imageryLayers.removeAll(true);
    const arcgisImagery = new Cesium.UrlTemplateImageryProvider({
      // Kostenfrei weil Free-Tier / GitHub Student Pack
      // ArcGIS World Imagery Tile Endpoint (public basemap fallback).
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    });

    activeFallbackImageryLayer = viewer.imageryLayers.addImageryProvider(arcgisImagery, 0);

    console.info('[WorldView][Fallback] OSM-Imagery aktiv', {
      imageryLayerCountAfter: viewer.imageryLayers.length,
      hasActiveFallbackLayer: Boolean(activeFallbackImageryLayer),
      fallbackProvider: 'ArcGIS World Imagery'
    });
  } catch (fallbackError) {
    console.error('[WorldView][Fallback] ArcGIS-Imagery konnte nicht aktiviert werden, versuche OSM', fallbackError);

    activeFallbackImageryLayer = viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/'
      }),
      0
    );
  }

  viewer.scene.requestRender();
}

// Kostenfrei weil Free-Tier / GitHub Student Pack
// Original Timeline & Replay-Fenster (God's Eye Stil)
viewer.timeline.zoomTo(
  Cesium.JulianDate.fromIso8601('2026-03-01T00:00:00Z'),
  Cesium.JulianDate.fromIso8601('2026-03-02T00:00:00Z')
);

if (viewer.scene.skyAtmosphere) {
  viewer.scene.skyAtmosphere.show = true;
}
setSceneGlobeVisibility(true, 'initial-viewer-boot');
viewer.scene.fog.enabled = true;
viewer.clock.multiplier = 300;
viewer.clock.shouldAnimate = true;
viewer.clock.multiplier = 480;

// Kostenfrei weil Free-Tier / GitHub Student Pack
Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18;

const layerState: Record<string, boolean> = {
  satellites: true,
  adsb: true,
  ais: true,
  jamming: true,
  noFlyZones: true,
  shaders: true
};

const layerCollections = {
  satellites: new Cesium.CustomDataSource('satellites-live-layer'),
  adsb: new Cesium.CustomDataSource('adsb-live-layer'),
  ais: new Cesium.CustomDataSource('ais-layer'),
  jamming: new Cesium.CustomDataSource('jamming-layer'),
  noFlyZones: new Cesium.CustomDataSource('no-fly-zones-layer')
};

const replaySources = {
  satellites: new Cesium.CzmlDataSource('satellites-replay-layer'),
  adsb: new Cesium.CzmlDataSource('adsb-replay-layer')
};

const replayExportCache: {
  satellites: object[];
  adsb: object[];
} = {
  satellites: [],
  adsb: []
};

viewer.dataSources.add(layerCollections.satellites);
viewer.dataSources.add(layerCollections.adsb);
viewer.dataSources.add(layerCollections.ais);
viewer.dataSources.add(layerCollections.jamming);
viewer.dataSources.add(layerCollections.noFlyZones);
viewer.dataSources.add(replaySources.satellites);
viewer.dataSources.add(replaySources.adsb);

const layerManager: Record<string, Cesium.DataSource> = {
  flights: layerCollections.adsb,
  adsb: layerCollections.adsb,
  ships: layerCollections.ais,
  ais: layerCollections.ais,
  satellites: layerCollections.satellites,
  jamming: layerCollections.jamming,
  noFlyZones: layerCollections.noFlyZones
};

function buildNoFlyZonesLayer(): void {
  layerCollections.noFlyZones.entities.removeAll();

  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // No-Fly Hauptzone Iran (orange) für Command-Center Overlay.
  layerCollections.noFlyZones.entities.add({
    id: 'no-fly-iran-main',
    name: 'No-Fly Zone Iran',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        44.5, 25.0,
        63.8, 25.0,
        63.8, 39.9,
        44.5, 39.9
      ]),
      material: Cesium.Color.ORANGE.withAlpha(0.22),
      outline: true,
      outlineColor: Cesium.Color.ORANGE.withAlpha(0.95)
    },
    label: {
      text: 'NO-FLY IRAN',
      font: '11pt monospace',
      fillColor: Cesium.Color.ORANGE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE
    }
  });

  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // No-Fly Golf-Region inkl. Straße von Hormuz (orange).
  layerCollections.noFlyZones.entities.add({
    id: 'no-fly-gulf-hormuz',
    name: 'No-Fly Zone Gulf / Hormuz',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        47.8, 22.0,
        60.4, 22.0,
        60.4, 31.7,
        47.8, 31.7
      ]),
      material: Cesium.Color.ORANGE.withAlpha(0.18),
      outline: true,
      outlineColor: Cesium.Color.ORANGE.withAlpha(0.9)
    },
    label: {
      text: 'NO-FLY GULF',
      font: '10pt monospace',
      fillColor: Cesium.Color.ORANGE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE
    }
  });
}

buildNoFlyZonesLayer();

replaySources.adsb.clustering.enabled = true;
replaySources.adsb.clustering.pixelRange = 15;
replaySources.adsb.clustering.minimumClusterSize = 3;

replaySources.adsb.clustering.clusterEvent.addEventListener((clusteredEntities, cluster) => {
  console.debug('[WorldView][ClusterEvent] ADS-B Cluster Rendering', {
    clusteredCount: clusteredEntities.length,
    hasLabel: Boolean(cluster.label),
    hasBillboard: Boolean(cluster.billboard),
    hasPoint: Boolean(cluster.point)
  });

  try {
    if (cluster.label) {
      cluster.label.show = true;
      cluster.label.text = `${clusteredEntities.length}`;
      cluster.label.scale = 0.7;
      cluster.label.fillColor = Cesium.Color.CYAN;
    }

    if (cluster.billboard) {
      cluster.billboard.show = false;
    }

    if (cluster.point) {
      cluster.point.show = true;
      cluster.point.pixelSize = 18;
      cluster.point.color = Cesium.Color.CYAN.withAlpha(0.85);
    }
  } catch (error) {
    console.error('[WorldView][ClusterEvent] Fehler beim Styling des Clusters', error);
  }
});

function setDataSourceVisibility(source: Cesium.DataSource | undefined, visible: boolean): void {
  if (source) {
    source.show = visible;
  }
}

async function processReplayChunks(
  dataSource: Cesium.CzmlDataSource,
  chunks: object[][],
  label: string,
  cacheKey: 'satellites' | 'adsb'
): Promise<void> {
  for (let i = 0; i < chunks.length; i += 1) {
    await dataSource.process(chunks[i]);
    replayExportCache[cacheKey].push(...chunks[i]);
    setStatus(`${label}: Chunk ${i + 1}/${chunks.length} geladen`);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

const replayEpoch = '2026-03-01T00:00:00Z';

const satellitesReplayChunks: object[][] = [
  [
    {
      id: 'document',
      version: '1.0',
      clock: {
        interval: '2026-03-01T00:00:00Z/2026-03-01T06:00:00Z',
        currentTime: '2026-03-01T00:00:00Z',
        multiplier: 60,
        range: 'LOOP_STOP',
        step: 'SYSTEM_CLOCK_MULTIPLIER'
      }
    },
    {
      id: 'sat-USA-234',
      availability: '2026-03-01T00:00:00Z/2026-03-01T06:00:00Z',
      point: {
        pixelSize: 7,
        color: { rgba: [255, 255, 0, 255] }
      },
      label: {
        text: 'USA-234',
        font: '11pt monospace',
        style: 'FILL_AND_OUTLINE',
        fillColor: { rgba: [255, 255, 0, 255] }
      },
      path: {
        resolution: 120,
        width: 1.5,
        leadTime: 600, // Performance: Reduziert von 1800s (30min) auf 600s (10min)
        trailTime: 600, // Performance: Reduziert für bessere FPS
        material: {
          solidColor: {
            color: { rgba: [255, 255, 0, 190] }
          }
        }
      },
      position: {
        epoch: replayEpoch,
        cartographicDegrees: [
          0, 50.1, 30.2, 430000,
          1800, 52.5, 31.8, 431000,
          3600, 55.0, 33.6, 432000,
          5400, 57.2, 34.4, 432500,
          7200, 58.8, 35.8, 433000
        ]
      }
    }
  ],
  [
    {
      id: 'sat-PERSONA-3',
      availability: '2026-03-01T02:00:00Z/2026-03-01T08:00:00Z',
      point: {
        pixelSize: 6,
        color: { rgba: [255, 170, 60, 255] }
      },
      label: {
        text: 'PERSONA-3',
        font: '11pt monospace'
      },
      path: {
        resolution: 120,
        width: 1.2,
        leadTime: 600, // Performance: Reduziert
        trailTime: 600, // Performance: Reduziert
        material: {
          solidColor: {
            color: { rgba: [255, 170, 60, 180] }
          }
        }
      },
      position: {
        epoch: replayEpoch,
        cartographicDegrees: [
          7200, 44.5, 26.4, 510000,
          9000, 46.2, 28.2, 509500,
          10800, 48.0, 30.5, 509000,
          12600, 49.9, 32.8, 508000,
          14400, 52.5, 34.3, 507500
        ]
      }
    }
  ]
];

const adsbReplayChunks: object[][] = [
  [
    {
      id: 'document',
      version: '1.0'
    },
    {
      id: 'flight-IRN001',
      availability: '2026-03-01T00:00:00Z/2026-03-01T03:00:00Z',
      billboard: {
        image: planeBlueIconDataUri,
        scale: 0.45,
        verticalOrigin: 'BOTTOM'
      },
      path: {
        resolution: 120,
        width: 1.2,
        leadTime: 600, // Performance: Reduziert
        trailTime: 600, // Performance: Reduziert
        material: {
          solidColor: {
            color: { rgba: [0, 200, 255, 210] }
          }
        }
      },
      position: {
        epoch: replayEpoch,
        cartographicDegrees: [
          0, 51.3, 34.8, 8500,
          900, 52.0, 33.9, 9200,
          1800, 53.1, 33.0, 9600,
          2700, 54.0, 32.4, 9800,
          3600, 54.8, 31.9, 10100
        ]
      },
      properties: {
        gpsJamming: {
          epoch: replayEpoch,
          boolean: [0, false, 1800, true, 3600, false]
        }
      }
    }
  ],
  [
    {
      id: 'flight-IRN002',
      availability: '2026-03-01T01:00:00Z/2026-03-01T04:00:00Z',
      billboard: {
        image: planeRedIconDataUri,
        scale: 0.45,
        verticalOrigin: 'BOTTOM'
      },
      path: {
        resolution: 120,
        width: 1.2,
        leadTime: 600, // Performance: Reduziert
        trailTime: 600, // Performance: Reduziert
        material: {
          solidColor: {
            color: { rgba: [255, 50, 50, 220] }
          }
        }
      },
      position: {
        epoch: replayEpoch,
        cartographicDegrees: [
          3600, 48.2, 30.2, 7200,
          4500, 49.1, 30.9, 7600,
          5400, 50.0, 31.5, 8000,
          6300, 50.7, 32.2, 8300,
          7200, 51.5, 32.9, 8600
        ]
      },
      properties: {
        gpsJamming: {
          epoch: replayEpoch,
          boolean: [3600, false, 5400, true, 7200, true]
        }
      }
    }
  ]
];

async function loadReplayData(): Promise<void> {
  setStatus('CZML Replay startet…');
  await processReplayChunks(replaySources.satellites, satellitesReplayChunks, 'Satelliten-CZML', 'satellites');
  await processReplayChunks(replaySources.adsb, adsbReplayChunks, 'ADS-B-CZML', 'adsb');

  const replayClock = replaySources.satellites.clock;
  if (replayClock) {
    viewer.clock.startTime = replayClock.startTime.clone();
    viewer.clock.stopTime = replayClock.stopTime.clone();
    viewer.clock.currentTime = replayClock.currentTime.clone();
    viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
  }

  setDataSourceVisibility(replaySources.satellites, layerState.satellites);
  setDataSourceVisibility(replaySources.adsb, layerState.adsb);
  setStatus('CZML Replay geladen (Multi-Part + incremental process).');
}

function downloadReplayExport(): void {
  const exportPackets = [
    ...replayExportCache.satellites,
    ...replayExportCache.adsb.filter((packet) => {
      const idValue = (packet as { id?: string }).id;
      return idValue !== 'document';
    })
  ];

  if (exportPackets.length === 0) {
    setStatus('Export nicht möglich: Replay-Daten noch nicht geladen.');
    return;
  }

  const blob = new Blob([JSON.stringify(exportPackets, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `worldview-replay-${new Date().toISOString().slice(0, 10)}.czml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  setStatus('Replay-CZML Export wurde heruntergeladen.');
}

function createBottomLayerBar(): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  const existingBar = document.querySelector('.layer-bar');
  if (existingBar) {
    existingBar.remove();
  }

  const bar = document.createElement('div');
  bar.className = 'layer-bar';
  bar.innerHTML = `
    <button type="button" data-bottom-layer="adsb">✈️ Flights</button>
    <button type="button" data-bottom-layer="satellites">🛰️ Satellites</button>
    <button type="button" data-bottom-layer="ais">🚢 AIS</button>
    <button type="button" data-bottom-layer="jamming">📡 GPS Jamming</button>
    <button type="button" data-bottom-layer="noFlyZones">⛔ No-Fly Zones</button>
  `;

  bar.querySelectorAll<HTMLButtonElement>('button[data-bottom-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = button.dataset.bottomLayer;
      if (!layer || !(layer in layerState)) {
        return;
      }

      const nextState = !layerState[layer];
      setLayerVisibility(layer, nextState);

      const checkbox = document.querySelector<HTMLInputElement>(`input[data-layer="${layer}"]`);
      if (checkbox) {
        checkbox.checked = nextState;
      }

      syncBottomLayerButtons();
    });
  });

  document.body.appendChild(bar);
  syncBottomLayerButtons();
}

function syncBottomLayerButtons(): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  const buttons = document.querySelectorAll<HTMLButtonElement>('.layer-bar button[data-bottom-layer]');
  buttons.forEach((button) => {
    const layer = button.dataset.bottomLayer;
    if (!layer || !(layer in layerState)) {
      return;
    }

    const isActive = Boolean(layerState[layer]);
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

async function loadDemoReplayFromPublicData(): Promise<void> {
  try {
    // God’s Eye Original-Look – Bilawal-Video March 2026
    setStatus('Demo-CZML wird geprüft…');
    const response = await fetch('/data/iran-demo.czml', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Demo-CZML HTTP ${response.status}`);
    }

    const demoJson = (await response.json()) as object[];
    const demoCzml = await Cesium.CzmlDataSource.load(demoJson);
    viewer.dataSources.add(demoCzml);

    const demoClock = demoCzml.clock;
    if (demoClock) {
      viewer.clock.startTime = demoClock.startTime.clone();
      viewer.clock.stopTime = demoClock.stopTime.clone();
      viewer.clock.currentTime = demoClock.currentTime.clone();
      viewer.timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
      viewer.clock.multiplier = 480;
    }

    setStatus('Demo-Replay geladen: iran-demo.czml');
  } catch (error) {
    console.warn('Demo-CZML konnte nicht geladen werden', error);
    setStatus('Demo-CZML fehlgeschlagen • nutze internes Multi-Part Replay');
  }
}

const liveSatellites = new Map<string, {
  satrec: SatRec;
  entity: Cesium.Entity;
  track: Cesium.SampledPositionProperty;
}>();

function resolveSatelliteStyle(rawName: string): { displayName: string; color: Cesium.Color; size: number } {
  const categoryMatch = rawName.match(/^\[(\w+)](.*)$/);
  const category = (categoryMatch?.[1] ?? 'active') as SatelliteCategory;
  const displayName = (categoryMatch?.[2] ?? rawName).trim();
  const style = satelliteCategories[category] ?? satelliteCategories.active;
  return {
    displayName,
    color: Cesium.Color.fromCssColorString(style.color),
    size: style.size
  };
}

function upsertLiveSatellite(name: string, satrec: SatRec): void {
  const now = new Date();
  const positionAndVelocity = propagate(satrec, now);
  if (!positionAndVelocity?.position) {
    return;
  }

  const position = positionAndVelocity.position;

  const gmst = gstime(now);
  const geodetic = eciToGeodetic(position, gmst);
  const lon = degreesLong(geodetic.longitude);
  const lat = degreesLat(geodetic.latitude);
  const height = geodetic.height * 1000;
  const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const nowJulian = Cesium.JulianDate.fromDate(now);
  const satelliteStyle = resolveSatelliteStyle(name);

  if (!liveSatellites.has(name)) {
    const sampledTrack = new Cesium.SampledPositionProperty();
    sampledTrack.setInterpolationOptions({
      interpolationAlgorithm: Cesium.LinearApproximation,
      interpolationDegree: 1
    });
    sampledTrack.addSample(nowJulian, cartesian);

    const entity = layerCollections.satellites.entities.add({
      id: `live-sat-${name}`,
      name: satelliteStyle.displayName,
      position: sampledTrack,
      point: {
        pixelSize: satelliteStyle.size,
        color: satelliteStyle.color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1
      },
      label: {
        text: `${satelliteStyle.displayName}`,
        font: '10pt monospace',
        fillColor: satelliteStyle.color,
        pixelOffset: new Cesium.Cartesian2(10, -10)
      },
      path: {
        // God’s Eye Original-Look – Bilawal-Video March 2026
        resolution: 120,
        width: 1.1,
        leadTime: 0,
        trailTime: 600, // Performance: Reduziert von 1800s auf 600s
        material: satelliteStyle.color.withAlpha(0.72)
      },
      properties: {
        callsign: satelliteStyle.displayName,
        noradId: name,
        speedKts: null
      }
    });

    liveSatellites.set(name, { satrec, entity, track: sampledTrack });
    return;
  }

  const existing = liveSatellites.get(name);
  if (existing) {
    existing.track.addSample(nowJulian, cartesian);
    existing.satrec = satrec;
  }
}

async function pollCelestrakLayer(): Promise<void> {
  try {
    if (!navigator.onLine) {
      setHealth('Netzwerk: offline • Celestrak Poll pausiert');
      return;
    }

    const lines = await fetchLiveTleLines();
    const maxSatellites = Math.min(80, Math.floor(lines.length / 3));

    for (let i = 0; i < maxSatellites; i += 1) {
      const base = i * 3;
      const name = lines[base];
      const line1 = lines[base + 1];
      const line2 = lines[base + 2];
      if (!name || !line1 || !line2) {
        continue;
      }

      const satrec = twoline2satrec(line1, line2);
      upsertLiveSatellite(name, satrec);
    }

    setStatus('Live satellites updated (Celestrak free feed).');
    setHealth('Network: online • Celestrak nominal');
    pushIncident(`Satellite sweep refreshed (${liveSatellites.size} tracks)`, 'INFO');
    markPollStatus('satellites', 'ok');
    viewer.scene.requestRender();
  } catch (error) {
    console.warn('Celestrak Polling fehlgeschlagen', error);
    setHealth('Network: degraded • Celestrak temporarily unavailable');
    markPollStatus('satellites', 'fallback');
  }
}

// Satelliten-Kategorien mit Farbcodierung für bessere Übersicht
const satelliteCategories = {
  gps: { group: 'gps-ops', color: '#00ff88', label: 'GPS', size: 8 },
  glonass: { group: 'glo-ops', color: '#ff4444', label: 'GLONASS', size: 8 },
  galileo: { group: 'galileo', color: '#4488ff', label: 'Galileo', size: 8 },
  starlink: { group: 'starlink', color: '#ffaa00', label: 'Starlink', size: 6 },
  iss: { group: 'stations', color: '#ffffff', label: 'ISS', size: 10 },
  active: { group: 'active', color: '#cccccc', label: 'SAT', size: 7 }
};

type SatelliteCategory = keyof typeof satelliteCategories;

async function fetchLiveTleLines(): Promise<string[]> {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Multi-Source: Versuche verschiedene Satelliten-Kategorien
  const allLines: string[] = [];
  const categoryKeys = Object.keys(satelliteCategories) as SatelliteCategory[];
  
  for (const key of categoryKeys) {
    try {
      const cat = satelliteCategories[key];
      const response = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${cat.group}&FORMAT=tle`);
      if (response.ok) {
        const tleText = await response.text();
        const lines = tleText.split('\n').map((line) => line.trim()).filter(Boolean);
        // Füge Kategorie-Info hinzu (wird in Verarbeitung genutzt)
        for (let i = 0; i < lines.length; i += 3) {
          if (lines[i] && lines[i + 1] && lines[i + 2]) {
            allLines.push(`[${key}]${lines[i]}`, lines[i + 1], lines[i + 2]);
          }
        }
      }
    } catch {
      // Einzelne Kategorie kann fehlschlagen, wir fahren fort
    }
  }
  
  if (allLines.length > 0) {
    return allLines;
  }
  
  // Fallback: Ivan API
  const tryIvan = async (): Promise<string[] | null> => {
    try {
      const response = await fetch('https://tle.ivanstanojevic.me/api/tle');
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        member?: Array<{
          name?: string;
          line1?: string;
          line2?: string;
          satelliteId?: number;
          date?: string;
        }>;
      };
      const entries = payload.member ?? [];
      const parsed: string[] = [];
      entries.slice(0, 100).forEach((entry) => {
        if (!entry.line1 || !entry.line2) return;
        parsed.push(`[active]${entry.name ?? `NORAD-${entry.satelliteId ?? 'UNK'}`}`);
        parsed.push(entry.line1.trim());
        parsed.push(entry.line2.trim());
      });
      return parsed.length >= 3 ? parsed : null;
    } catch {
      return null;
    }
  };

  const ivanLines = await tryIvan();
  if (ivanLines) {
    setHealth('Network: online • TLE source: ivanstanojevic.me');
    return ivanLines;
  }

  return [];
}

const adsbFallbackSeeds = Array.from({ length: 24 }, (_, index) => {
  const military = index % 5 === 0 || index % 7 === 0;
  const ring = index % 12;
  return {
    id: `adsb-fallback-${index + 1}`,
    callsign: military ? `RECON-${200 + index}` : `GULF-${400 + index}`,
    // Schwerpunkt Iran/Golf, damit Tracks im Standard-View sofort sichtbar sind.
    lon: 48.8 + ring * 0.72,
    lat: 26.1 + (index % 6) * 0.85,
    altitude: 4200 + (index % 8) * 900,
    speedKts: 240 + (index % 7) * 35,
    isMilitary: military
  };
});

function clearAdsbFallbackTracks(): void {
  adsbFallbackSeeds.forEach((seed) => {
    const existing = adsbTrackRegistry.get(seed.id);
    if (!existing) {
      return;
    }
    layerCollections.adsb.entities.remove(existing.entity);
    adsbTrackRegistry.delete(seed.id);
  });
}

function upsertAdsbFallbackTracks(sourceLabel: string): void {
  const nowEpochMs = Date.now();

  adsbFallbackSeeds.forEach((seed, index) => {
    const existing = adsbTrackRegistry.get(seed.id);
    if (existing) {
      existing.lastSeenEpochMs = nowEpochMs - (adsbTrackStaleThresholdMs + 1_000);
      existing.altitudeM = seed.altitude;
      existing.isMilitary = seed.isMilitary;
      existing.entity.show = true;
      return;
    }

    const colorFriendly = Cesium.Color.fromCssColorString('#ffd24a').withAlpha(0.95);
    const colorHostile = Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.96);
    const isMilitary = seed.isMilitary;
    const flightColor = isMilitary ? colorHostile : colorFriendly;
    const fallbackPosition = new Cesium.CallbackPositionProperty(() => {
      // Realtime-Drift auf Wall-Clock-Basis (nicht Timeline-basiert), damit Tracks
      // nicht synchron vor/zurück oszillieren, sondern individuell "forward" laufen.
      const nowSec = Date.now() / 1000;
      const headingDeg = (index * 37 + 25) % 360;
      const headingRad = Cesium.Math.toRadians(headingDeg);
      const speedMs = Math.max(90, seed.speedKts * 0.514444 * 0.32);
      const routeLengthM = 170_000 + (index % 5) * 45_000;
      const distanceM = ((nowSec + index * 173) * speedMs) % routeLengthM;

      const lat0 = seed.lat;
      const lon0 = seed.lon;
      const metersPerDegLat = 111_320;
      const metersPerDegLon = Math.max(1, 111_320 * Math.cos(Cesium.Math.toRadians(lat0)));

      const lat = lat0 + (Math.cos(headingRad) * distanceM) / metersPerDegLat;
      const lon = lon0 + (Math.sin(headingRad) * distanceM) / metersPerDegLon;
      return Cesium.Cartesian3.fromDegrees(lon, lat, seed.altitude);
    }, false);

    const entity = layerCollections.adsb.entities.add({
      id: seed.id,
      name: seed.callsign,
      position: fallbackPosition,
      billboard: {
        image: isMilitary ? planeRedIconDataUri : planeBlueIconDataUri,
        scale: 0.46,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        color: flightColor,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000)
      },
      path: {
        resolution: 120,
        width: isMilitary ? 1.5 : 1.2,
        leadTime: 300, // Performance: Reduziert
        trailTime: 600, // Performance: Reduziert
        material: isMilitary ? Cesium.Color.RED.withAlpha(0.7) : Cesium.Color.fromCssColorString('#ffb347').withAlpha(0.62)
      },
      label: {
        text: `${seed.callsign} • ALT ${seed.altitude}m`,
        font: '9pt monospace',
        fillColor: isMilitary ? Cesium.Color.RED : Cesium.Color.fromCssColorString('#ffd24a'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        show: isMilitary,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000)
      },
      properties: {
        callsign: seed.callsign,
        altitude: seed.altitude,
        speedKts: seed.speedKts,
        gpsJamming: false,
        status: `FALLBACK TRACK (${sourceLabel})`
      }
    });

    adsbTrackRegistry.set(seed.id, {
      key: seed.id,
      entity,
      isMilitary,
      altitudeM: seed.altitude,
      lastSeenEpochMs: nowEpochMs - (adsbTrackStaleThresholdMs + 1_000),
      positionTrack: undefined
    });
  });

  applyFlightVisibilityFilters();
  pushIncident(`Fallback air picture active (${adsbFallbackSeeds.length} synthetic tracks)`, 'WARN');
}

async function pollAdsbLayer(): Promise<void> {
  try {
    if (!navigator.onLine) {
      setHealth('Network: offline • ADS-B polling paused');
      return;
    }

    let activeFeedLabel = 'OpenSky';
    let data: OpenSkyStatesResponse = { states: [] };

    try {
      data = await openSkyApi.statesAll({ lamin: 24, lomin: 44, lamax: 40, lomax: 64 });
    } catch (openSkyError) {
      console.warn('[WorldView][Flights] OpenSky states/all fehlgeschlagen, nutze Fallback', openSkyError);
      setHealth('OpenSky states/all unavailable • switching to OpenSky fallback');
      activeFeedLabel = 'OpenSky fallback';
      // Hier werden Fallback-Daten geladen statt Fehler zu werfen
      upsertAdsbFallbackTracks('OpenSky fallback');
      setDataSourceVisibility(replaySources.adsb, true);
      return;
    }

    const militaryTracks: Array<{ callsign: string; altitude: string; speed: string; source: string }> = [];
    const maxFlights = 120;
    const states = data.states ?? [];
    let renderedFlights = 0;
    const seenTrackKeys = new Set<string>();
    const nowEpochMs = Date.now();
    let sampleIcao24 = '';
    let sampleTrackLastContactSec = 0;

    if (states.length > 0) {
      clearAdsbFallbackTracks();
    }

    for (let i = 0; i < Math.min(states.length, maxFlights); i += 1) {
      const state = states[i];
      const trackKey = normalizeAdsbTrackKey(state, i);
      seenTrackKeys.add(trackKey);
      const icao24 = String(state[0] ?? '').trim().toLowerCase();
      const callsign = String(state[1] ?? 'UNKNOWN').trim();
      const lon = Number(state[5]);
      const lat = Number(state[6]);
      const altitude = Number(state[7] ?? 0);
      const velocityMs = Number(state[9] ?? NaN);
      const speedKts = Number.isFinite(velocityMs) ? velocityMs * 1.94384 : NaN;
      const headingDeg = Number(state[10] ?? NaN);
      const lastContactSec = Number(state[4] ?? 0);
      const isStale = Number.isFinite(lastContactSec)
        ? nowEpochMs - (lastContactSec * 1000) > adsbTrackStaleThresholdMs
        : false;

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }

      const isMilitary = isAdsbMilitaryTrack(callsign);
      const isBlue = !isMilitary && i % 2 === 0;
      const colorFriendly = Cesium.Color.fromCssColorString('#ffd24a').withAlpha(0.95);
      const colorHostile = Cesium.Color.fromCssColorString('#ff5a5a').withAlpha(0.96);
      const flightColor = isMilitary ? colorHostile : colorFriendly;

      const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);
      const sampleTime = Cesium.JulianDate.fromDate(new Date(nowEpochMs));
      const predictionSeconds = 10;
      let predictedLon = lon;
      let predictedLat = lat;
      if (Number.isFinite(velocityMs) && Number.isFinite(headingDeg)) {
        const headingRad = Cesium.Math.toRadians(headingDeg);
        const distanceM = velocityMs * predictionSeconds;
        const latRad = Cesium.Math.toRadians(lat);
        const metersPerDegLat = 111320;
        const metersPerDegLon = Math.max(1, 111320 * Math.cos(latRad));
        predictedLat = lat + (Math.cos(headingRad) * distanceM) / metersPerDegLat;
        predictedLon = lon + (Math.sin(headingRad) * distanceM) / metersPerDegLon;
      }
      const predictedPosition = Cesium.Cartesian3.fromDegrees(predictedLon, predictedLat, altitude);
      const predictedSampleTime = Cesium.JulianDate.addSeconds(sampleTime, predictionSeconds, new Cesium.JulianDate());
      const existingTrack = adsbTrackRegistry.get(trackKey);
      if (existingTrack) {
        if (existingTrack.positionTrack) {
          existingTrack.positionTrack.addSample(sampleTime, position);
          existingTrack.positionTrack.addSample(predictedSampleTime, predictedPosition);
        } else {
          existingTrack.entity.position = new Cesium.ConstantPositionProperty(position);
        }
        if (existingTrack.entity.label) {
          existingTrack.entity.label.text = new Cesium.ConstantProperty(`${callsign} • ALT ${Math.max(0, altitude).toFixed(0)}m`);
        }
        existingTrack.isMilitary = isMilitary;
        existingTrack.altitudeM = Math.max(0, altitude);
        existingTrack.lastSeenEpochMs = Number.isFinite(lastContactSec) && lastContactSec > 0
          ? lastContactSec * 1000
          : nowEpochMs;
        existingTrack.entity.properties = new Cesium.PropertyBag({
          callsign,
          altitude,
          speedKts,
          icao24,
          lastContactSec,
          gpsJamming: isStale,
          status: isMilitary ? 'MILITARY TRACK' : 'TRACKING'
        });
      } else {
        const newEntity = layerCollections.adsb.entities.add({
          id: trackKey,
          name: callsign,
          position: (() => {
            const sampled = new Cesium.SampledPositionProperty();
            sampled.setInterpolationOptions({
              interpolationAlgorithm: Cesium.LinearApproximation,
              interpolationDegree: 1
            });
            sampled.addSample(sampleTime, position);
            sampled.addSample(predictedSampleTime, predictedPosition);
            return sampled;
          })(),
          billboard: {
            // God’s Eye Original-Look – Bilawal-Video March 2026
            image: isBlue ? planeBlueIconDataUri : planeRedIconDataUri,
            scale: 0.46,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            color: flightColor,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000)
          },
          path: {
            resolution: 120,
            width: isMilitary ? 1.5 : 1.2,
            leadTime: 300, // Performance: Reduziert
            trailTime: 600, // Performance: Reduziert
            material: isMilitary ? Cesium.Color.RED.withAlpha(0.7) : Cesium.Color.fromCssColorString('#ffb347').withAlpha(0.62)
          },
          label: {
            text: `${callsign} • ALT ${Math.max(0, altitude).toFixed(0)}m`,
            font: '9pt monospace',
            fillColor: isMilitary ? Cesium.Color.RED : Cesium.Color.fromCssColorString('#ffd24a'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(8, -8),
            show: true,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20_000_000)
          },
          properties: {
            callsign,
            altitude,
            speedKts,
            icao24,
            lastContactSec,
            gpsJamming: isStale,
            status: isMilitary ? 'MILITARY TRACK' : 'TRACKING'
          }
        });

        adsbTrackRegistry.set(trackKey, {
          key: trackKey,
          entity: newEntity,
          isMilitary,
          altitudeM: Math.max(0, altitude),
          lastSeenEpochMs: Number.isFinite(lastContactSec) && lastContactSec > 0
            ? lastContactSec * 1000
            : nowEpochMs,
          positionTrack: newEntity.position as Cesium.SampledPositionProperty
        });
      }

      if (!sampleIcao24 && icao24) {
        sampleIcao24 = icao24;
        sampleTrackLastContactSec = Number.isFinite(lastContactSec) && lastContactSec > 0
          ? lastContactSec
          : Math.floor(nowEpochMs / 1000);
      }

      if (isMilitary) {
        militaryTracks.push({
          callsign,
          altitude: `${Math.max(0, altitude).toFixed(0)} m`,
          speed: Number.isFinite(speedKts) ? `${speedKts.toFixed(0)} kts` : '—',
          source: activeFeedLabel
        });
      }

      renderedFlights += 1;
    }

    adsbTrackRegistry.forEach((track, key) => {
      if (seenTrackKeys.has(key)) {
        return;
      }

      const ageMs = nowEpochMs - track.lastSeenEpochMs;
      if (ageMs > 10 * 60 * 1000) {
        layerCollections.adsb.entities.remove(track.entity);
        adsbTrackRegistry.delete(key);
      }
    });

    if (states.length === 0) {
      upsertAdsbFallbackTracks(activeFeedLabel);
    }

    applyFlightVisibilityFilters();
    if (sampleIcao24) {
      void refreshOpenSkyIntelSnapshot(sampleIcao24, sampleTrackLastContactSec);
    }

    renderMilitaryInfoPanel(militaryTracks);
    if (militaryTracks.length > 0) {
      pushIncident(`Military correlation: ${militaryTracks.length} active tracks`, 'ALERT');
    }

    if (renderedFlights === 0) {
      // God’s Eye Original-Look – Bilawal-Video March 2026
      // Produktions-Hardening: Bei leerem API-Response bleibt Flug-Layer sichtbar (Replay/CZML).
      setDataSourceVisibility(replaySources.adsb, true);
      updateRuntimeDiagnostics({
        flightsFeed: 'Replay/CZML fallback',
        flightsDetail: `${activeFeedLabel} returned 0 flights • Replay/CZML remains visible`
      });
    } else {
      updateRuntimeDiagnostics({
        flightsFeed: activeFeedLabel === 'OpenSky' ? 'OpenSky online' : 'OpenSky fallback',
        flightsDetail: `${activeFeedLabel} states/all • ${renderedFlights} flights rendered • ${adsbTrackRegistry.size} active tracks`
      });
    }

    setStatus(`Live ADS-B updated (${activeFeedLabel}).`);
    setHealth(`Network: online • Flights: ${activeFeedLabel}`);
    markPollStatus('flights', activeFeedLabel === 'OpenSky' ? 'ok' : 'fallback');
    viewer.scene.requestRender();
  } catch (error) {
    console.warn('ADS-B Polling fehlgeschlagen', error);
    // God’s Eye Original-Look – Bilawal-Video March 2026
    // Produktions-Hardening: Bei API/CORS/Rate-Limit Fehlern bleibt mindestens Replay/CZML-Flugverkehr sichtbar.
    upsertAdsbFallbackTracks('Offline fallback');
    setDataSourceVisibility(replaySources.adsb, true);
    pushIncident('OpenSky unavailable • fallback tactical air picture engaged', 'WARN');
    updateRuntimeDiagnostics({
      flightsFeed: 'Replay/CZML fallback',
      flightsDetail: 'Live feed unavailable (API/CORS/rate-limit) • Replay/CZML stays active'
    });
    setHealth('Network: degraded • OpenSky feed temporarily unavailable');
    markPollStatus('flights', 'fallback');
  }
}

function buildAisFallbackLayer(): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  // Lokaler AIS-Fallback bleibt immer sichtbar, falls Live-Feed ausfällt oder nicht konfiguriert ist.
  layerCollections.ais.entities.removeAll();
  const fallbackShips = [
    { id: 'ais-fallback-1', name: 'MT HORMUZ STAR', lon: 56.35, lat: 26.5, speed: 0.032 },
    { id: 'ais-fallback-2', name: 'MV GULF LINK', lon: 56.45, lat: 26.25, speed: 0.021 },
    { id: 'ais-fallback-3', name: 'IRISL BANDAR', lon: 56.65, lat: 26.0, speed: 0.026 }
  ];

  fallbackShips.forEach((ship) => {
    layerCollections.ais.entities.add({
      id: ship.id,
      position: new Cesium.CallbackPositionProperty((time?: Cesium.JulianDate) => {
        const currentTime = time ?? viewer.clock.currentTime;
        const seconds = Cesium.JulianDate.secondsDifference(currentTime, viewer.clock.startTime);
        const lon = ship.lon + (seconds % 2400) * ship.speed * 0.0001;
        return Cesium.Cartesian3.fromDegrees(lon, ship.lat, 0);
      }, false),
      billboard: {
        image: shipIconDataUri,
        scale: 0.45,
        color: Cesium.Color.CYAN.withAlpha(0.92)
      },
      label: {
        text: ship.name,
        font: '10pt monospace',
        fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -10),
        show: true
      },
      path: {
        resolution: 120,
        width: 1,
        leadTime: 0,
        trailTime: 600, // Performance: Reduziert
        material: Cesium.Color.CYAN.withAlpha(0.55)
      }
    });
  });
}

type ParsedAisShip = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  speedKnots?: number;
  courseDegrees?: number;
};

type AisTrack = {
  id: string;
  name: string;
  position: Cesium.SampledPositionProperty;
  entity: Cesium.Entity;
  lastSeenEpochMs: number;
  lastRenderUpdateEpochMs: number;
};

const liveAisTracks = new Map<string, AisTrack>();
let aisSocket: WebSocket | null = null;
let aisSocketWasClosedIntentionally = false;
let aisLastLiveMessageEpochMs = 0;
let aisWatchdogIntervalId: number | null = null;
let aisReconnectTimeoutId: number | null = null;
let aisReconnectAttempt = 0;

function closeAisSocket(): void {
  aisSocketWasClosedIntentionally = true;
  if (!aisSocket) {
    return;
  }

  try {
    aisSocket.close();
  } catch (error) {
    console.warn('[WorldView][AIS] Socket konnte nicht geschlossen werden', error);
  }

  aisSocket = null;
}

function clearAisReconnectTimer(): void {
  if (aisReconnectTimeoutId === null) {
    return;
  }

  window.clearTimeout(aisReconnectTimeoutId);
  aisReconnectTimeoutId = null;
}

function getAisReconnectDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  const exponentialDelay = Math.min(aisReconnectBaseDelayMs * (2 ** (safeAttempt - 1)), aisReconnectMaxDelayMs);
  const jitter = Math.floor(Math.random() * aisReconnectJitterMs);
  return exponentialDelay + jitter;
}

function scheduleAisReconnect(reason: string): void {
  if (!layerState.ais || !navigator.onLine) {
    return;
  }

  if (aisReconnectTimeoutId !== null) {
    return;
  }

  if (!aisWebSocketApiKey) {
    updateRuntimeDiagnostics({
      aisFeed: 'AIS fallback',
      aisDetail: 'AISStream API key missing • local simulation remains active'
    });
    markPollStatus('ais', 'fallback');
    return;
  }

  aisReconnectAttempt = Math.min(aisReconnectAttempt + 1, aisReconnectMaxAttempts);
  const delayMs = getAisReconnectDelayMs(aisReconnectAttempt);
  updateRuntimeDiagnostics({
    aisFeed: 'AIS fallback',
    aisDetail: `${reason} • Reconnect in ~${Math.round(delayMs / 1000)}s (Versuch ${aisReconnectAttempt}/${aisReconnectMaxAttempts})`
  });
  markPollStatus('ais', 'fallback');

  aisReconnectTimeoutId = window.setTimeout(() => {
    aisReconnectTimeoutId = null;
    if (!layerState.ais || !navigator.onLine) {
      return;
    }
    startAisLiveFeed();
  }, delayMs);
}

function parseFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseAisShipsFromMessage(payload: unknown): ParsedAisShip[] {
  const ships: ParsedAisShip[] = [];

  if (!payload || typeof payload !== 'object') {
    return ships;
  }

  const source = payload as Record<string, unknown>;

  // God’s Eye Original-Look – Bilawal-Video March 2026
  // AISStream-Normalisierung: PositionReport + EnhancedPositionReport in ein einheitliches Vessel-Objekt.
  const metadata = source.MetaData as Record<string, unknown> | undefined;
  const messageContainer = source.Message as Record<string, unknown> | undefined;
  const reportCandidates: Array<Record<string, unknown> | undefined> = [
    messageContainer?.PositionReport as Record<string, unknown> | undefined,
    messageContainer?.EnhancedPositionReport as Record<string, unknown> | undefined,
    source.PositionReport as Record<string, unknown> | undefined,
    source.EnhancedPositionReport as Record<string, unknown> | undefined
  ];

  for (const report of reportCandidates) {
    if (!report) {
      continue;
    }

    const lat = parseFiniteNumber(report.Latitude ?? report.Lat);
    const lon = parseFiniteNumber(report.Longitude ?? report.Lon);
    const mmsi = String(metadata?.MMSI ?? report.UserID ?? report.MMSI ?? '').trim();

    if (lat === null || lon === null || mmsi.length === 0) {
      continue;
    }

    ships.push({
      id: mmsi,
      name: String(metadata?.ShipName ?? metadata?.CallSign ?? `MMSI ${mmsi}`).trim(),
      lat,
      lon,
      speedKnots: parseFiniteNumber(report.Sog ?? report.SpeedOverGround) ?? undefined,
      courseDegrees: parseFiniteNumber(report.Cog ?? report.CourseOverGround) ?? undefined
    });
    return ships;
  }

  const candidateArray = Array.isArray(source.ships)
    ? (source.ships as unknown[])
    : Array.isArray(source.data)
      ? (source.data as unknown[])
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];

  candidateArray.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const record = entry as Record<string, unknown>;
    const lat = parseFiniteNumber(record.lat ?? record.latitude ?? record.Latitude);
    const lon = parseFiniteNumber(record.lon ?? record.lng ?? record.longitude ?? record.Longitude);
    const id = String(record.mmsi ?? record.MMSI ?? record.id ?? '').trim();
    if (lat === null || lon === null || id.length === 0) {
      return;
    }

    ships.push({
      id,
      name: String(record.name ?? record.shipName ?? record.vessel ?? `MMSI ${id}`).trim(),
      lat,
      lon,
      speedKnots: parseFiniteNumber(record.sog ?? record.speed ?? record.SOG) ?? undefined,
      courseDegrees: parseFiniteNumber(record.cog ?? record.course ?? record.COG) ?? undefined
    });
  });

  return ships;
}

function pruneStaleAisTracks(nowEpochMs: number): void {
  liveAisTracks.forEach((track, id) => {
    if (nowEpochMs - track.lastSeenEpochMs <= aisStaleAfterMs) {
      return;
    }

    layerCollections.ais.entities.remove(track.entity);
    liveAisTracks.delete(id);
  });
}

function upsertLiveAisShip(ship: ParsedAisShip, nowEpochMs: number): void {
  const currentJulian = Cesium.JulianDate.fromDate(new Date(nowEpochMs));
  const position = Cesium.Cartesian3.fromDegrees(ship.lon, ship.lat, 0);
  const normalizedName = ship.name.length > 0 ? ship.name : `MMSI ${ship.id}`;

  const existing = liveAisTracks.get(ship.id);
  if (!existing) {
    const sampled = new Cesium.SampledPositionProperty();
    sampled.setInterpolationOptions({
      interpolationAlgorithm: Cesium.LinearApproximation,
      interpolationDegree: 1
    });
    sampled.addSample(currentJulian, position);

    const entity = layerCollections.ais.entities.add({
      id: `ais-live-${ship.id}`,
      name: normalizedName,
      position: sampled,
      billboard: {
        image: shipIconDataUri,
        scale: 0.48,
        color: Cesium.Color.CYAN.withAlpha(0.94)
      },
      label: {
        text: normalizedName,
        font: '10pt monospace',
        fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -10),
        show: true
      },
      path: {
        resolution: 120,
        width: 1.25,
        leadTime: 0,
        trailTime: 600, // Performance: Reduziert von 1800s auf 600s
        material: Cesium.Color.fromCssColorString('#7ee7ff').withAlpha(0.72)
      },
      properties: {
        callsign: normalizedName,
        speedKts: ship.speedKnots ?? null,
        status: 'AIS TRACK'
      }
    });

    liveAisTracks.set(ship.id, {
      id: ship.id,
      name: normalizedName,
      position: sampled,
      entity,
      lastSeenEpochMs: nowEpochMs,
      lastRenderUpdateEpochMs: nowEpochMs
    });
    return;
  }

  existing.lastSeenEpochMs = nowEpochMs;
  if (nowEpochMs - existing.lastRenderUpdateEpochMs < aisUpdateThrottleMs) {
    return;
  }

  existing.position.addSample(currentJulian, position);
  existing.lastRenderUpdateEpochMs = nowEpochMs;
  existing.name = normalizedName;
  if (existing.entity.label) {
    existing.entity.label.text = new Cesium.ConstantProperty(normalizedName);
  }
}

function switchToAisFallback(reason: string): void {
  closeAisSocket();
  liveAisTracks.clear();
  buildAisFallbackLayer();
  updateRuntimeDiagnostics({
    aisFeed: 'AIS fallback',
    aisDetail: reason
  });
  setStatus('AIS fallback mode active (local simulation).');
  pushIncident('AIS live link lost • fallback maritime simulation active', 'WARN');
  markPollStatus('ais', 'fallback');
  viewer.scene.requestRender();
}

function startAisLiveFeed(): void {
  if (!layerState.ais) {
    return;
  }

  if (!navigator.onLine) {
    switchToAisFallback('Offline erkannt • lokale AIS-Simulation aktiv');
    return;
  }

  if (!aisWebSocketApiKey) {
    switchToAisFallback('AISStream API-Key fehlt • lokale AIS-Simulation aktiv');
    return;
  }

  clearAisReconnectTimer();
  closeAisSocket();
  aisSocketWasClosedIntentionally = false;
  aisLastLiveMessageEpochMs = 0;
  updateRuntimeDiagnostics({
    aisFeed: 'Initializing…',
    aisDetail: 'Connecting AISStream websocket…'
  });

  try {
    aisSocket = new WebSocket(aisWebSocketUrl);
  } catch (error) {
    console.warn('[WorldView][AIS] WebSocket-Initialisierung fehlgeschlagen', error);
    switchToAisFallback('AIS-WebSocket konnte nicht initialisiert werden • Fallback aktiv');
    return;
  }

  aisSocket.addEventListener('open', () => {
    aisReconnectAttempt = 0;

    // Kostenfrei weil Free-Tier / GitHub Student Pack:
    // kleine Bounding Boxes + MessageTypes [1,2,3] reduzieren Datenvolumen und schonen Limits.
    try {
      aisSocket?.send(
        JSON.stringify({
          APIKey: aisWebSocketApiKey,
          BoundingBoxes: aisDefaultBoundingBoxes,
          MessageTypes: [...aisMessageTypes]
        })
      );
    } catch (error) {
      console.warn('[WorldView][AIS] Subscription konnte nicht gesendet werden', error);
      switchToAisFallback('AIS Subscription fehlgeschlagen • lokale AIS-Simulation aktiv');
      scheduleAisReconnect('AIS Subscription fehlgeschlagen');
      return;
    }

    updateRuntimeDiagnostics({
      aisFeed: 'Initializing…',
      aisDetail: 'AISStream connected • awaiting PositionReport packets'
    });
  });

  aisSocket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      console.debug('[WorldView][AIS] Nicht-JSON Nachricht ignoriert', error);
      return;
    }

    const ships = parseAisShipsFromMessage(payload);
    if (ships.length === 0) {
      return;
    }

    if (liveAisTracks.size === 0) {
      layerCollections.ais.entities.removeAll();
    }

    const nowEpochMs = Date.now();
    aisLastLiveMessageEpochMs = nowEpochMs;
    ships.forEach((ship) => {
      upsertLiveAisShip(ship, nowEpochMs);
    });
    pruneStaleAisTracks(nowEpochMs);

    updateRuntimeDiagnostics({
      aisFeed: 'AIS live',
      aisDetail: `WebSocket live • ${liveAisTracks.size} vessels visible`
    });
    setStatus('AIS Live-Feed aktiv.');
    if (liveAisTracks.size > 6) {
      pushIncident(`Maritime feed dense: ${liveAisTracks.size} vessels in AOI`, 'INFO');
    }
    markPollStatus('ais', 'ok');
    viewer.scene.requestRender();
  });

  aisSocket.addEventListener('error', () => {
    switchToAisFallback('AIS-WebSocket Fehler • lokale AIS-Simulation aktiv');
    scheduleAisReconnect('AIS-WebSocket Fehler');
  });

  aisSocket.addEventListener('close', () => {
    if (aisSocketWasClosedIntentionally) {
      return;
    }
    switchToAisFallback('AIS-WebSocket geschlossen • lokale AIS-Simulation aktiv');
    scheduleAisReconnect('AIS-WebSocket geschlossen');
  });

  if (aisWatchdogIntervalId === null) {
    aisWatchdogIntervalId = window.setInterval(() => {
      if (!navigator.onLine) {
        return;
      }
      pruneStaleAisTracks(Date.now());
      if (!aisSocket || aisSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (aisLastLiveMessageEpochMs === 0) {
        return;
      }

      const silenceMs = Date.now() - aisLastLiveMessageEpochMs;
      if (silenceMs > aisSilenceThresholdMs) {
        switchToAisFallback('AIS Live-Timeout (>90s ohne Daten) • lokale AIS-Simulation aktiv');
        scheduleAisReconnect('AIS Live-Timeout');
      }
    }, 15 * 1000);
  }
}

function buildJammingLayerFromReplay(): void {
  layerCollections.jamming.entities.removeAll();

  const pulseColor = new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty(() => {
      const pulse = 0.22 + ((Math.sin(Date.now() / 900) + 1) * 0.5 * 0.23);
      return Cesium.Color.RED.withAlpha(pulse);
    }, false)
  );

  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Dynamische Jamming-Zone über Straße von Hormuz.
  layerCollections.jamming.entities.add({
    id: 'jamming-dynamic-hormuz',
    name: 'GPS Jamming Dynamic Hormuz',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        55.7, 26.4,
        56.8, 26.4,
        56.8, 25.4,
        55.7, 25.4
      ]),
      material: pulseColor,
      outline: true,
      outlineColor: Cesium.Color.RED.withAlpha(0.96)
    },
    label: {
      text: 'GPS JAMMING (DYNAMIC)',
      font: '10pt monospace',
      fillColor: Cesium.Color.RED,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE
    }
  });

  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Statische Jamming-Zone im Iran (Demonstrator für Replay-Signale).
  layerCollections.jamming.entities.add({
    id: 'jamming-iran-static',
    name: 'GPS Jamming Static Iran',
    position: Cesium.Cartesian3.fromDegrees(52.5, 30.5, 1000),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        51.9, 31.1,
        53.2, 31.1,
        53.2, 29.9,
        51.9, 29.9
      ]),
      material: Cesium.Color.RED.withAlpha(0.28),
      outline: true,
      outlineColor: Cesium.Color.RED.withAlpha(0.98)
    },
    label: {
      text: 'GPS JAMMING (STATIC)',
      font: '11pt monospace',
      fillColor: Cesium.Color.RED,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE
    }
  });
}

const crtStage = new Cesium.PostProcessStage({
  name: 'worldview-crt',
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  fragmentShader: `
    uniform sampler2D colorTexture;
    in vec2 v_textureCoordinates;
    uniform float u_intensity;
    out vec4 fragColor;

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float scan = sin(uv.y * 1500.0) * 0.09 * u_intensity;
      float scan2 = sin((uv.y + uv.x * 0.08) * 720.0) * 0.03 * u_intensity;
      float vignette = smoothstep(0.95, 0.2, distance(uv, vec2(0.5)));
      vec3 crt = color.rgb * (1.0 - 0.2 * u_intensity) + vec3(scan + scan2);
      crt *= mix(1.0, vignette, 0.45 * u_intensity);
      fragColor = vec4(crt, color.a);
    }
  `,
  uniforms: {
    u_intensity: 0.34
  }
});

const nvgStage = new Cesium.PostProcessStage({
  name: 'worldview-nvg',
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  fragmentShader: `
    uniform sampler2D colorTexture;
    in vec2 v_textureCoordinates;
    uniform float u_intensity;
    out vec4 fragColor;

    float random(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float noise = (random(uv * 2300.0) - 0.5) * 0.18 * u_intensity;
      vec3 nvg = vec3(0.03, 1.0, 0.12) * (luma + noise + 0.15 * u_intensity);
      fragColor = vec4(clamp(nvg, 0.0, 1.0), color.a);
    }
  `,
  uniforms: {
    u_intensity: 0.65
  }
});

const flirStage = new Cesium.PostProcessStage({
  name: 'worldview-flir',
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  fragmentShader: `
    uniform sampler2D colorTexture;
    in vec2 v_textureCoordinates;
    uniform float u_intensity;
    out vec4 fragColor;

    vec3 heatRamp(float t) {
      vec3 cold = vec3(0.02, 0.05, 0.18);
      vec3 mid = vec3(0.78, 0.20, 0.08);
      vec3 hot = vec3(1.00, 0.93, 0.65);
      if (t < 0.5) {
        return mix(cold, mid, t * 2.0);
      }
      return mix(mid, hot, (t - 0.5) * 2.0);
    }

    void main() {
      vec2 uv = v_textureCoordinates;
      vec4 color = texture(colorTexture, uv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float thermal = pow(luma, mix(1.65, 0.42, u_intensity));
      thermal = smoothstep(0.06, 0.94, thermal);
      vec3 flir = heatRamp(clamp(thermal * 1.12, 0.0, 1.0));
      fragColor = vec4(flir, color.a);
    }
  `,
  uniforms: {
    u_intensity: 0.65
  }
});

viewer.scene.postProcessStages.add(crtStage);
viewer.scene.postProcessStages.add(nvgStage);
viewer.scene.postProcessStages.add(flirStage);

let activeShaderMode: ShaderMode = 'none';

function setShaderIntensity(intensity: number): void {
  crtStage.uniforms.u_intensity = Math.max(0.2, intensity * 0.42);
  nvgStage.uniforms.u_intensity = intensity;
  flirStage.uniforms.u_intensity = Math.max(1.2, intensity * 2.15);
  viewer.scene.requestRender();
}

function setShaderMode(mode: ShaderMode): void {
  activeShaderMode = mode;
  setHudModeClass(mode);

  const shadersEnabled = layerState.shaders;
  // God’s Eye Original-Look – Bilawal-Video March 2026
  // CRT bleibt subtil permanent aktiv, FLIR/NVG werden zusätzlich je nach Modus geschaltet.
  crtStage.enabled = shadersEnabled;
  nvgStage.enabled = shadersEnabled && mode === 'nvg';
  flirStage.enabled = shadersEnabled && mode === 'flir';

  const modeLabel = mode === 'none' ? 'OFF' : mode.toUpperCase();
  setStatus(`Vision mode: ${shadersEnabled ? modeLabel : 'DISABLED (LAYER OFF)'}`);
  syncTopModeButtons();
  viewer.scene.requestRender();
}

function syncTopModeButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-top-mode]');
  buttons.forEach((button) => {
    const mode = button.dataset.topMode as ShaderMode | undefined;
    const isActive = mode === activeShaderMode;
    button.classList.toggle('is-active', Boolean(isActive));
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function bindTopModeSwitch(): void {
  // Neue Vision Mode Buttons (data-vision Attribut)
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-vision]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.vision as ShaderMode | undefined;
      if (!mode) {
        return;
      }
      setShaderMode(mode);
      
      // Update active state on buttons
      buttons.forEach((btn) => btn.classList.remove('is-active'));
      button.classList.add('is-active');
      
      // Update header vision mode text
      if (activeVisionMode) {
        activeVisionMode.textContent = `VISION: ${mode.toUpperCase()}`;
      }
    });
  });
}

function bindLayerBar(): void {
  const layerButtons = document.querySelectorAll<HTMLButtonElement>('.layer-btn[data-layer]');
  layerButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const layerName = button.dataset.layer;
      if (!layerName) {
        return;
      }
      
      // Toggle active state
      const isActive = button.classList.contains('is-active');
      button.classList.toggle('is-active', !isActive);
      button.setAttribute('aria-pressed', (!isActive).toString());
      
      // Call toggle function
      toggleLayer(layerName);
    });
  });
}

function toggleLayer(layerName: string): void {
  if (layerName === 'shaders') {
    setLayerVisibility('shaders', !layerState.shaders);
    return;
  }

  const mappedLayer = layerName === 'flights' ? 'adsb' : layerName;
  if (!(mappedLayer in layerState)) {
    console.warn('[WorldView][Layers] Unbekannter Layer', { layerName });
    return;
  }

  const current = layerState[mappedLayer];
  setLayerVisibility(mappedLayer, !current);
}

viewer.selectedEntityChanged.addEventListener((entity) => {
  if (!entity) {
    return;
  }

  renderEntityInfoPanel(entity);
  viewer.selectedEntity = undefined;
  viewer.scene.requestRender();
});

(window as unknown as { showAllEntities?: () => void; toggleLayer?: (name: string) => void }).showAllEntities = () => {
  showAllObjects();
};

(window as unknown as { showAllEntities?: () => void; toggleLayer?: (name: string) => void }).toggleLayer = toggleLayer;

function setLayerVisibility(layer: string, visible: boolean): void {
  if (!(layer in layerState)) {
    return;
  }

  layerState[layer] = visible;

  if (layer === 'shaders') {
    setShaderMode(activeShaderMode);
    syncBottomLayerButtons();
    return;
  }

  const liveSource = layerCollections[layer as keyof typeof layerCollections];
  if (liveSource) {
    liveSource.show = visible;
  }

  if (layer === 'satellites') {
    setDataSourceVisibility(replaySources.satellites, visible);
  }

  if (layer === 'adsb') {
    setDataSourceVisibility(replaySources.adsb, visible);
  }

  // God’s Eye Original-Look – Bilawal-Video March 2026
  syncBottomLayerButtons();
  setStatus(`Layer ${layer.toUpperCase()}: ${visible ? 'ACTIVE' : 'OFF'}`);
  if (layer === 'adsb' && visible) {
    applyFlightVisibilityFilters();
  }
  viewer.scene.requestRender();
}

function flyToPreset(preset: CameraPresetKey): void {
  const view = cameraPresets[preset];
  setStatus(`Camera repositioning to: ${preset.toUpperCase()}`);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
    orientation: {
      heading: Cesium.Math.toRadians(view.heading),
      pitch: Cesium.Math.toRadians(view.pitch),
      roll: 0
    },
    duration: 2.2
  });

  if (preset === 'hormuz') {
    setShaderMode('crt');
    pushIncident('Scenario preset HORMUZ // maritime choke-point monitoring', 'INFO');
  }

  if (preset === 'tehran' || preset === 'natanz') {
    setShaderMode('nvg');
    pushIncident(`Scenario preset ${preset.toUpperCase()} // high-priority land AOI`, 'ALERT');
  }
}

function bindToolbarEvents(): void {
  const cameraButtons = document.querySelectorAll<HTMLButtonElement>('button[data-camera]');
  cameraButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.camera as CameraPresetKey;
      if (!key || !(key in cameraPresets)) {
        return;
      }
      flyToPreset(key);
    });
  });

  const layerCheckboxes = document.querySelectorAll<HTMLInputElement>('input[data-layer]');
  layerCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const layer = checkbox.dataset.layer;
      if (!layer) {
        return;
      }
      setLayerVisibility(layer, checkbox.checked);
      syncBottomLayerButtons();
    });
  });

  const showAllObjectsButton = document.getElementById('showAllObjectsButton') as HTMLButtonElement | null;
  if (showAllObjectsButton) {
    showAllObjectsButton.addEventListener('click', () => {
      showAllObjects();
    });
  }

  const hideAllObjectsButton = document.getElementById('hideAllObjectsButton') as HTMLButtonElement | null;
  if (hideAllObjectsButton) {
    hideAllObjectsButton.addEventListener('click', () => {
      hideAllObjects();
    });
  }

  const flightVisibilityModeSelect = document.getElementById('flightVisibilityMode') as HTMLSelectElement | null;
  if (flightVisibilityModeSelect) {
    flightVisibilityModeSelect.addEventListener('change', () => {
      const mode = flightVisibilityModeSelect.value as FlightVisibilityMode;
      if (mode === 'all' || mode === 'military' || mode === 'civilian') {
        flightVisibilityState.mode = mode;
        applyFlightVisibilityFilters();
        setStatus(`Flight visibility mode: ${mode.toUpperCase()}`);
      }
    });
  }

  const flightAltitudeBandSelect = document.getElementById('flightAltitudeBand') as HTMLSelectElement | null;
  if (flightAltitudeBandSelect) {
    flightAltitudeBandSelect.addEventListener('change', () => {
      const altitudeBand = flightAltitudeBandSelect.value as FlightAltitudeBand;
      if (altitudeBand === 'all' || altitudeBand === 'low' || altitudeBand === 'mid' || altitudeBand === 'high') {
        flightVisibilityState.altitudeBand = altitudeBand;
        applyFlightVisibilityFilters();
        setStatus(`Flight altitude filter: ${altitudeBand.toUpperCase()}`);
      }
    });
  }

  const staleTracksOnlyToggle = document.getElementById('staleTracksOnly') as HTMLInputElement | null;
  if (staleTracksOnlyToggle) {
    staleTracksOnlyToggle.addEventListener('change', () => {
      flightVisibilityState.staleOnly = staleTracksOnlyToggle.checked;
      applyFlightVisibilityFilters();
      setStatus(`Stale-track filter: ${flightVisibilityState.staleOnly ? 'ON' : 'OFF'}`);
    });
  }

  const resetVisibilityFiltersButton = document.getElementById('resetVisibilityFiltersButton') as HTMLButtonElement | null;
  if (resetVisibilityFiltersButton) {
    resetVisibilityFiltersButton.addEventListener('click', () => {
      flightVisibilityState.mode = 'all';
      flightVisibilityState.altitudeBand = 'all';
      flightVisibilityState.staleOnly = false;
      if (flightVisibilityModeSelect) {
        flightVisibilityModeSelect.value = 'all';
      }
      if (flightAltitudeBandSelect) {
        flightAltitudeBandSelect.value = 'all';
      }
      if (staleTracksOnlyToggle) {
        staleTracksOnlyToggle.checked = false;
      }
      manuallyHiddenEntityIds.clear();
      applyFlightVisibilityFilters();
      setStatus('Visibility filters reset.');
    });
  }

  const shaderModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="shaderMode"]');
  shaderModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        setShaderMode(radio.value as ShaderMode);
      }
    });
  });

  const intensitySlider = document.getElementById('shaderIntensity') as HTMLInputElement | null;
  if (intensitySlider) {
    intensitySlider.addEventListener('input', () => {
      const intensity = Number(intensitySlider.value);
      setShaderIntensity(Number.isFinite(intensity) ? intensity : 0.65);
    });
  }

  // Export and fullscreen buttons removed from new HUD design

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.fullscreenElement) {
      void document.exitFullscreen();
      setStatus('Fullscreen HUD exited via ESC');
    }
  });

  window.addEventListener('online', () => {
    setHealth('Network: online');
    void pollCelestrakLayer();
    void pollAdsbLayer();
    startAisLiveFeed();
  });

  window.addEventListener('offline', () => {
    setHealth('Network: offline • live feeds paused');
    switchToAisFallback('Offline erkannt • lokale AIS-Simulation aktiv');
  });
}

function installRoadTrafficParticles(): void {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Lightweight Traffic-Particle Overlay im Stil des Original-HUDs.
  const seeds = [
    { id: 'traffic-hormuz-1', lon: 56.22, lat: 26.14, heading: 0.0014 },
    { id: 'traffic-hormuz-2', lon: 56.38, lat: 26.21, heading: -0.0011 },
    { id: 'traffic-hormuz-3', lon: 56.55, lat: 26.02, heading: 0.0018 },
    { id: 'traffic-iran-1', lon: 51.39, lat: 35.72, heading: 0.0012 },
    { id: 'traffic-iran-2', lon: 51.52, lat: 35.64, heading: -0.0013 }
  ];

  seeds.forEach((seed, index) => {
    layerCollections.jamming.entities.add({
      id: `${seed.id}-particle`,
      position: new Cesium.CallbackPositionProperty((time?: Cesium.JulianDate) => {
        const current = time ?? viewer.clock.currentTime;
        const elapsed = Cesium.JulianDate.secondsDifference(current, viewer.clock.startTime);
        const drift = ((elapsed + index * 180) % 900) * seed.heading * 0.015;
        return Cesium.Cartesian3.fromDegrees(seed.lon + drift, seed.lat + Math.sin(elapsed * 0.006 + index) * 0.012, 30);
      }, false),
      point: {
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString('#ffd24a').withAlpha(0.82),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.65),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: {
        callsign: `TRAFFIC-${index + 1}`,
        status: 'GROUND FLOW'
      }
    });
  });
}

function installCctvIcons(): void {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  const cctvIcon = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="#9affd8" d="M8 26h28l8-7h12v8H46l-8 7H8z"/><circle cx="20" cy="44" r="6" fill="#00ff9d"/></svg>'
  );

  const cameras = [
    { id: 'cctv-hormuz', name: 'CCTV HORMUZ CAM-01', lon: 56.44, lat: 26.12 },
    { id: 'cctv-tehran', name: 'CCTV TEHRAN CAM-03', lon: 51.41, lat: 35.69 },
    { id: 'cctv-bandar', name: 'CCTV BANDAR CAM-02', lon: 56.27, lat: 27.18 }
  ];

  cameras.forEach((camera) => {
    layerCollections.noFlyZones.entities.add({
      id: camera.id,
      name: camera.name,
      position: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 120),
      billboard: {
        image: cctvIcon,
        scale: 0.42,
        color: Cesium.Color.fromCssColorString('#9affd8').withAlpha(0.95),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: camera.name,
        font: '9pt monospace',
        fillColor: Cesium.Color.fromCssColorString('#9affd8'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 700_000)
      },
      properties: {
        callsign: camera.name,
        status: 'VISUAL FEED'
      }
    });
  });
}

function bindInteractionHandlers(): void {
  // God’s Eye Original-Look – Bilawal-Video March 2026
  pointerHandler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
    updateHoverInfo(movement.endPosition.x, movement.endPosition.y);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  pointerHandler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
    const picked = viewer.scene.pick(click.position);
    if (!Cesium.defined(picked) || !(picked as { id?: unknown }).id) {
      renderEntityInfoPanel(null);
      return;
    }

    const entity = (picked as { id: Cesium.Entity }).id;
    renderEntityInfoPanel(entity);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function initThreeHudOverlay(): void {
  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Three.js + GSAP Overlay für Command-Center Motion-Details.
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.className = 'three-hud-overlay';
  document.body.appendChild(overlayCanvas);

  const renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const ringGeometry = new THREE.RingGeometry(0.45, 0.46, 96);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff9d, transparent: true, opacity: 0.18 });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  scene.add(ring);

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff9d, transparent: true, opacity: 0.32 });
  const linePoints = [
    new THREE.Vector3(-0.95, -0.65, 0),
    new THREE.Vector3(-0.15, -0.2, 0),
    new THREE.Vector3(0.2, 0.0, 0),
    new THREE.Vector3(0.95, 0.58, 0)
  ];
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const flowLine = new THREE.Line(lineGeometry, lineMaterial);
  scene.add(flowLine);

  gsap.to(ring.rotation, {
    z: Math.PI * 2,
    duration: 18,
    repeat: -1,
    ease: 'none'
  });

  gsap.to(ringMaterial, {
    opacity: 0.32,
    duration: 2.6,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut'
  });

  const render = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  render();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function addArcGisStaticBasemapOverlay(): void {
  if (!arcgisApiKey) {
    return;
  }

  try {
    // Kostenfrei weil Free-Tier / GitHub Student Pack
    // ArcGIS Static Basemap Tiles (optional Overlay; key in env).
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/${arcgisBasemapStyle}/{z}/{x}/{y}?token=${arcgisApiKey}`
    });
    viewer.imageryLayers.addImageryProvider(provider, 1);
  } catch (error) {
    console.warn('[WorldView][ArcGIS] Static basemap overlay konnte nicht initialisiert werden', error);
  }
}

async function addGooglePhotorealisticTiles(): Promise<void> {
  const showTilesFallbackOverlay = (details: string): void => {
    const id = 'tilesFallbackBanner';
    const existing = document.getElementById(id);
    if (existing) {
      existing.textContent = details;
      return;
    }

    const banner = document.createElement('div');
    banner.id = id;
    banner.className = 'tiles-fallback-banner';
    banner.textContent = details;
    document.body.appendChild(banner);
  };

  const googleApiKey = googleMapTilesKey;

  if (!googleApiKey) {
    updateRuntimeDiagnostics({
      tilesPath: 'OSM Fallback',
      tilesDetail: 'VITE_GOOGLE_MAP_TILES_KEY fehlt/leer (Vercel Project Settings → Environment Variables)'
    });
  }

  try {
    if (!googleApiKey) {
      throw new Error('Kein VITE_GOOGLE_MAP_TILES_KEY gesetzt');
    }

    console.info('[WorldView][Tiles] Starte direkten Google API-Key Pfad');
    // Kostenfrei weil Free-Tier / GitHub Student Pack
    // Variante 1 – Direkte URL (empfohlen, einfach):
    const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleApiKey}`;
    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, {
      showCreditsOnScreen: true,
      maximumScreenSpaceError: 2
    });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false; // Globe aus, nur Tiles
    setSceneGlobeVisibility(false, 'google-direct-tileset-ready');
    updateRuntimeDiagnostics({
      tilesPath: 'Google Direct',
      tilesDetail: 'Direkter Google Map Tiles API-Key Pfad aktiv'
    });
    setStatus('Google Photorealistic 3D Tiles active (direct Google API).');
  } catch (directError) {
    console.error('[WorldView][Tiles] Google Map Tiles API (direct) fehlgeschlagen', {
      directError
    });

    // Variante 2 – Google Helper (Cesium.createGooglePhotorealistic3DTileset)
    // Offizieller CesiumJS-Helfer – oft robuster als direkte URL
    try {
      console.info('[WorldView][Tiles] Versuche Google Helper (createGooglePhotorealistic3DTileset)');
      const tileset = await Cesium.createGooglePhotorealistic3DTileset();
      viewer.scene.primitives.add(tileset);
      viewer.scene.globe.show = false; // Globe aus, nur Tiles
      setSceneGlobeVisibility(false, 'google-helper-tileset-ready');
      updateRuntimeDiagnostics({
        tilesPath: 'Google Helper',
        tilesDetail: 'Cesium createGooglePhotorealistic3DTileset() aktiv'
      });
      setStatus('Google Photorealistic 3D Tiles active (Cesium helper).');
    } catch (helperError) {
      console.error('[WorldView][Tiles] Google Helper auch fehlgeschlagen', {
        helperError
      });

      ensureVisibleFreeTierGlobeFallback('Google Tiles fehlgeschlagen (Direct + Helper)');
      showTilesFallbackOverlay('Google Map Tiles API nicht verfügbar. Setze in Vercel ENV exakt: VITE_GOOGLE_MAP_TILES_KEY=... (Map Tiles API Key). OSM-Fallback aktiv.');
      updateRuntimeDiagnostics({
        tilesPath: 'OSM Fallback',
        tilesDetail: 'Google Map Tiles API + Helper fehlgeschlagen. Benötigt: VITE_GOOGLE_MAP_TILES_KEY in Vercel.'
      });
      setStatus('Fallback active: globe visible, Google Map Tiles unavailable.');
      setHealth('Network: degraded • Google Tiles fallback active');
    }
  }

  flyToPreset('hormuz');
}

function startRateLimitedPollers(): void {
  if (!navigator.onLine) {
    setHealth('Network: offline • pollers in standby');
    return;
  }

  void pollCelestrakLayer();
  void pollAdsbLayer();

  // Kostenfrei weil Free-Tier / GitHub Student Pack
  // Schonend: 10 Minuten für TLE, 10 Sekunden für ADS-B Free API.
  window.setInterval(() => {
    void pollCelestrakLayer();
  }, 10 * 60 * 1000);

  window.setInterval(() => {
    void pollAdsbLayer();
  }, 10 * 1000);
  
  // Neue Live-Datenquellen initialisieren
  // Beide Quellen parallel - opendata.adsb.fi als robuste Alternative
  initOpenSkyLiveFlights();
  initAdsbFiFlights(); // Alternative ADS-B Quelle (kein Rate-Limit)
  initAISStreamLiveShips();
}

// === LIVE FLUGZEUGE – OpenSky Network (kostenlos) ===
// Kostenfrei weil Free-Tier / GitHub Student Pack
let openSkyDataSource: Cesium.CustomDataSource | null = null;

async function initOpenSkyLiveFlights(): Promise<void> {
  const openSkyBaseUrl = import.meta.env.VITE_OPENSKY_BASE_URL || 'https://opensky-network.org/api';
  
  // DataSource erstellen
  openSkyDataSource = new Cesium.CustomDataSource('OpenSky Live Flights');
  await viewer.dataSources.add(openSkyDataSource);
  
  // Clustering aktivieren für Performance
  openSkyDataSource.clustering.enabled = true;
  openSkyDataSource.clustering.pixelRange = 60;
  openSkyDataSource.clustering.minimumClusterSize = 4;
  
  let isRateLimited = false;
  
  async function updateFlights() {
    // Skip if rate limited - wait for next cycle
    if (isRateLimited) {
      console.log('[OpenSky] Rate limit active, skipping update');
      return;
    }
    
    try {
      // Bounding Box für MENA Region (ca. 20°N-40°N, 30°E-60°E)
      const url = `${openSkyBaseUrl}/states/all?lamin=20&lamax=40&lomin=30&lomax=60`;
      
      // Optional: Auth falls konfiguriert
      const openSkyUser = import.meta.env.VITE_OPENSKY_USERNAME as string | undefined;
      const openSkyPass = import.meta.env.VITE_OPENSKY_PASSWORD as string | undefined;
      
      const headers: Record<string, string> = {};
      if (openSkyUser && openSkyPass) {
        const auth = btoa(`${openSkyUser}:${openSkyPass}`);
        headers['Authorization'] = `Basic ${auth}`;
      }
      
      const res = await fetch(url, { headers });
      
      if (res.status === 429) {
        console.warn('[OpenSky] Rate limit (429) hit – waiting 30 seconds');
        isRateLimited = true;
        markPollStatus('flights', 'opensky-rate-limited');
        setTimeout(() => { isRateLimited = false; }, 30000);
        return;
      }
      
      if (!res.ok) {
        console.warn('[OpenSky] API Fehler:', res.status);
        markPollStatus('flights', `opensky-error-${res.status}`);
        return;
      }

      const data = await res.json();
      if (!data.states || data.states.length === 0) {
        return;
      }

      // Alte Entities entfernen
      openSkyDataSource?.entities.removeAll();

      data.states.forEach((state: any[]) => {
        const [icao24, callsign, originCountry, , , lon, lat, baroAltitude, onGround, velocity, heading] = state;

        if (!lon || !lat || onGround) return; // nur fliegende

        const alt = baroAltitude ? baroAltitude : 10000; // m
        const speed = velocity ? Math.round(velocity * 3.6) : 0; // km/h
        
        // Flugzeug-Entity erstellen
        openSkyDataSource?.entities.add({
          id: `opensky-${icao24}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
          billboard: {
            image: planeBlueIconDataUri,
            scale: 0.6,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            color: speed > 700 ? Cesium.Color.fromCssColorString('#ff5a5a') : Cesium.Color.fromCssColorString('#00ff9d'),
            rotation: heading ? Cesium.Math.toRadians(Number(heading)) : 0,
            alignedAxis: Cesium.Cartesian3.UNIT_Z
          },
          label: {
            text: (callsign || icao24).trim().substring(0, 8),
            font: 'bold 11px "Courier New", monospace',
            fillColor: Cesium.Color.fromCssColorString('#00ff9d'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -25),
            show: true
          },
          properties: {
            icao24,
            callsign: callsign || 'UNKNOWN',
            originCountry: originCountry || 'UNKNOWN',
            altitude: Math.round(alt),
            speed,
            source: 'OpenSky Network'
          }
        });
      });

      console.log(`[OpenSky] Loaded ${data.states.length} flights`);
      markPollStatus('flights', 'opensky-online');
      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[OpenSky] Fehler:', err);
      markPollStatus('flights', 'opensky-error');
    }
  }

  // Alle 15 Sekunden aktualisieren (sicherer Rate-Limit)
  updateFlights();
  const openSkyInterval = window.setInterval(updateFlights, 15000);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(openSkyInterval);
  });
  
  console.info('[OpenSky] Live Flights initialisiert');
}

// === ALTERNATIVE ADS-B QUELLE: opendata.adsb.fi (kein Rate-Limit) ===
// Kostenfrei weil Free-Tier / GitHub Student Pack
let adsbFiDataSource: Cesium.CustomDataSource | null = null;
const adsbFiTracks = new Map<string, {
  entity: Cesium.Entity;
  position: Cesium.SampledPositionProperty;
  lastSeenEpochMs: number;
}>();

async function initAdsbFiFlights(): Promise<void> {
  // opendata.adsb.fi - kostenlose ADS-B Daten ohne Rate-Limit
  const adsbFiUrl = import.meta.env.VITE_ADSB_FALLBACK_URL || 'https://opendata.adsb.fi/api/v2/lat/24/lon/44/dist/220';
  
  adsbFiDataSource = new Cesium.CustomDataSource('ADSB.fi Live Flights');
  await viewer.dataSources.add(adsbFiDataSource);
  
  // Clustering aktivieren
  adsbFiDataSource.clustering.enabled = true;
  adsbFiDataSource.clustering.pixelRange = 60;
  adsbFiDataSource.clustering.minimumClusterSize = 4;
  
  async function updateAdsbFiFlights() {
    try {
      const res = await fetch(adsbFiUrl);
      if (!res.ok) {
        console.warn('[ADSB.fi] API Fehler:', res.status);
        markPollStatus('flights', 'adsb-fi-error');
        return;
      }

      const data = await res.json();
      if (!data.aircraft || data.aircraft.length === 0) {
        return;
      }

      data.aircraft.forEach((aircraft: any) => {
        if (!aircraft.lat || !aircraft.lon || aircraft.ground) return;
        
        const alt = aircraft.alt_baro || aircraft.alt_geom || 10000;
        const speed = aircraft.gs || 0;
        const callsign = aircraft.callsign || aircraft.icao24;
        
        const id = `adsbfi-${aircraft.icao24}`;
        const now = new Date();
        const nowJulian = Cesium.JulianDate.fromDate(now);
        const cartesian = Cesium.Cartesian3.fromDegrees(aircraft.lon, aircraft.lat, alt);
        const headingDeg = Number(aircraft.track ?? aircraft.true_track ?? 0);
        const entityColor = speed > 450
          ? Cesium.Color.fromCssColorString('#ff6b6b')
          : Cesium.Color.fromCssColorString('#ffb347');

        const existing = adsbFiTracks.get(id);
        if (!existing) {
          const sampledPosition = new Cesium.SampledPositionProperty();
          sampledPosition.setInterpolationOptions({
            interpolationAlgorithm: Cesium.LinearApproximation,
            interpolationDegree: 1
          });
          sampledPosition.addSample(nowJulian, cartesian);

          const entity = adsbFiDataSource?.entities.add({
            id,
            position: sampledPosition,
            billboard: {
              image: planeBlueIconDataUri,
              scale: 0.55,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              color: entityColor,
              rotation: Cesium.Math.toRadians(headingDeg),
              alignedAxis: Cesium.Cartesian3.UNIT_Z
            },
            label: {
              text: callsign ? callsign.trim().substring(0, 8) : aircraft.icao24,
              font: 'bold 10px "Courier New", monospace',
              fillColor: entityColor,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              pixelOffset: new Cesium.Cartesian2(0, -20),
              show: true
            },
            path: {
              resolution: 60,
              width: 1.0,
              leadTime: 0,
              trailTime: 300,
              material: entityColor.withAlpha(0.55)
            },
            properties: {
              icao24: aircraft.icao24,
              callsign: callsign || 'UNKNOWN',
              altitude: alt,
              speed: Math.round(speed * 1.852), // knots to km/h
              source: 'ADSB.fi'
            }
          });

          if (entity) {
            adsbFiTracks.set(id, {
              entity,
              position: sampledPosition,
              lastSeenEpochMs: now.getTime()
            });
          }
          return;
        }

        existing.position.addSample(nowJulian, cartesian);
        existing.lastSeenEpochMs = now.getTime();
        if (existing.entity.billboard) {
          existing.entity.billboard.rotation = new Cesium.ConstantProperty(Cesium.Math.toRadians(headingDeg));
          existing.entity.billboard.color = new Cesium.ConstantProperty(entityColor);
        }
        if (existing.entity.label) {
          existing.entity.label.fillColor = new Cesium.ConstantProperty(entityColor);
        }
      });

      const staleBefore = Date.now() - 120_000;
      adsbFiTracks.forEach((track, id) => {
        if (track.lastSeenEpochMs < staleBefore) {
          adsbFiDataSource?.entities.removeById(id);
          adsbFiTracks.delete(id);
        }
      });

      console.log(`[ADSB.fi] Loaded ${data.aircraft.length} flights`);
      markPollStatus('flights', 'adsb-fi-online');
      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[ADSB.fi] Fehler:', err);
      markPollStatus('flights', 'adsb-fi-error');
    }
  }

  // Alle 10 Sekunden aktualisieren (opendata.adsb.fi hat kein bekanntes Rate-Limit)
  updateAdsbFiFlights();
  window.setInterval(updateAdsbFiFlights, 10000);
  
  console.info('[ADSB.fi] Live Flights initialisiert');
}

// === LIVE SCHIFFE – AISStream.io (kostenlos) ===
// Kostenfrei weil Free-Tier / GitHub Student Pack
function initAISStreamLiveShips(): void {
  const aisKey = import.meta.env.VITE_AISSTREAM_API_KEY as string | undefined;
  
  if (!aisKey) {
    console.info('[AISStream] Kein API Key konfiguriert - überspringe');
    return;
  }

  // Nutze bereits vorhandene layerCollections.ais statt neuer DataSource
  // Clustering aktivieren
  layerCollections.ais.clustering.enabled = true;
  layerCollections.ais.clustering.pixelRange = 50;
  layerCollections.ais.clustering.minimumClusterSize = 3;

  function connect() {
    aisSocket = new WebSocket('wss://stream.aisstream.io/v0/stream');

    aisSocket.onopen = () => {
      console.info('[AISStream] WebSocket verbunden');
      markPollStatus('ais', 'aisstream-connected');
      
      // Bounding Box für Straße von Hormuz / Persischer Golf
      // [lat_min, lon_min], [lat_max, lon_max]
      aisSocket?.send(JSON.stringify({
        APIkey: aisKey,
        BoundingBoxes: [[[23.5, 55.0], [28.0, 58.0]]]
      }));
    };

    aisSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (![1, 2, 3].includes(msg.MessageType)) return;

        const pos = msg.Message.PositionReport || msg.Message.EnhancedPositionReport;
        if (!pos) return;

        const mmsi = msg.MetaData.MMSI.toString();
        const name = (msg.MetaData.ShipName || 'UNKNOWN').trim();
        const sog = msg.Message.PositionReport?.Sog || 0; // Speed over ground

        let entity = layerCollections.ais.entities.getById(`ais-${mmsi}`);

        if (!entity) {
          // Neues Schiff erstellen
          layerCollections.ais.entities.add({
            id: `ais-${mmsi}`,
            position: Cesium.Cartesian3.fromDegrees(pos.Longitude, pos.Latitude, 0),
            billboard: {
              image: shipIconDataUri,
              scale: 0.7,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              color: Cesium.Color.fromCssColorString('#7ee7ff')
            },
            label: {
              text: name.length > 15 ? name.substring(0, 12) + '...' : name,
              font: '10px "Courier New", monospace',
              fillColor: Cesium.Color.fromCssColorString('#7ee7ff'),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              pixelOffset: new Cesium.Cartesian2(0, -20)
            },
            properties: {
              mmsi,
              name,
              speed: sog,
              source: 'AISStream.io'
            }
          });
        } else {
          // Position updaten (verwende ConstantPositionProperty)
          entity.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(pos.Longitude, pos.Latitude, 0)
          );
        }

        viewer.scene.requestRender();
      } catch (e) {
        console.error('[AISStream] Parse-Fehler:', e);
      }
    };

    aisSocket.onclose = () => {
      console.info('[AISStream] Verbindung getrennt - reconnect in 10s');
      markPollStatus('ais', 'aisstream-reconnecting');
      window.setTimeout(connect, 10000);
    };

    aisSocket.onerror = (err) => {
      console.error('[AISStream] WebSocket Fehler:', err);
      markPollStatus('ais', 'aisstream-error');
    };
  }

  connect();
  console.info('[AISStream] Live Ships initialisiert');
}

bindToolbarEvents();
bindTopModeSwitch();
bindLayerBar();
bindInteractionHandlers();
initThreeHudOverlay();
createBottomLayerBar();
setShaderMode('none');
setShaderIntensity(0.65);
buildJammingLayerFromReplay();
installRoadTrafficParticles();
installCctvIcons();
setStatus('Viewer initialized. Loading Google 3D Tiles…');
setHealth(navigator.onLine ? 'Network: online' : 'Network: offline');
renderRuntimeDiagnosticsHud();
renderPollingIndicator();
renderEntityInfoPanel(null);
renderIncidentFeed();
initHudTelemetryTicker();
startAisLiveFeed();
void loadDemoReplayFromPublicData();
void loadReplayData();
startRateLimitedPollers();
addArcGisStaticBasemapOverlay();
void addGooglePhotorealisticTiles();
