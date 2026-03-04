import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec
} from 'satellite.js';
import { injectSpeedInsights } from '@vercel/speed-insights';

// Initialize Vercel Speed Insights
injectSpeedInsights();

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
const exportReplayButton = document.getElementById('exportReplayButton') as HTMLButtonElement | null;

if (!container) {
  throw new Error('cesiumContainer wurde nicht gefunden.');
}

function setStatus(message: string): void {
  if (statusText) {
    statusText.textContent = message;
  }
}

function setHealth(message: string): void {
  if (healthText) {
    healthText.textContent = message;
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
  globe: false,
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
  maximumRenderTimeChange: Infinity
});

if (viewer.scene.skyAtmosphere) {
  viewer.scene.skyAtmosphere.show = true;
}
viewer.scene.globe.show = false;
viewer.scene.fog.enabled = true;
viewer.clock.multiplier = 60;
viewer.clock.shouldAnimate = true;

// Kostenfrei weil Free-Tier / GitHub Student Pack
Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18;

const layerState: Record<string, boolean> = {
  satellites: true,
  adsb: true,
  ais: true,
  jamming: true,
  shaders: true
};

const layerCollections = {
  satellites: new Cesium.CustomDataSource('satellites-live-layer'),
  adsb: new Cesium.CustomDataSource('adsb-live-layer'),
  ais: new Cesium.CustomDataSource('ais-layer'),
  jamming: new Cesium.CustomDataSource('jamming-layer')
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
viewer.dataSources.add(replaySources.satellites);
viewer.dataSources.add(replaySources.adsb);

replaySources.adsb.clustering.enabled = true;
replaySources.adsb.clustering.pixelRange = 15;
replaySources.adsb.clustering.minimumClusterSize = 3;

replaySources.adsb.clustering.clusterEvent.addEventListener((clusteredEntities, cluster) => {
  cluster.label.show = true;
  cluster.label.text = `${clusteredEntities.length}`;
  cluster.label.scale = 0.7;
  cluster.label.fillColor = Cesium.Color.CYAN;
  cluster.billboard.show = false;
  cluster.point.show = true;
  cluster.point.pixelSize = 18;
  cluster.point.color = Cesium.Color.CYAN.withAlpha(0.85);
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
        leadTime: 1800,
        trailTime: 1800,
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
        leadTime: 1800,
        trailTime: 1800,
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
        image: 'https://cdn.jsdelivr.net/gh/cesiumlab/aircraft-icons@main/plane-blue.png',
        scale: 0.45,
        verticalOrigin: 'BOTTOM'
      },
      path: {
        resolution: 120,
        width: 1.2,
        leadTime: 1800,
        trailTime: 1800,
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
        image: 'https://cdn.jsdelivr.net/gh/cesiumlab/aircraft-icons@main/plane-red.png',
        scale: 0.45,
        verticalOrigin: 'BOTTOM'
      },
      path: {
        resolution: 120,
        width: 1.2,
        leadTime: 1800,
        trailTime: 1800,
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

const liveSatellites = new Map<string, { satrec: SatRec; entity: Cesium.Entity }>();

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

  if (!liveSatellites.has(name)) {
    const entity = layerCollections.satellites.entities.add({
      id: `live-sat-${name}`,
      name,
      position: cartesian,
      point: {
        pixelSize: 5,
        color: Cesium.Color.YELLOW
      },
      label: {
        text: name,
        font: '10pt monospace',
        fillColor: Cesium.Color.YELLOW,
        pixelOffset: new Cesium.Cartesian2(10, -10)
      }
    });

    liveSatellites.set(name, { satrec, entity });
    return;
  }

  const existing = liveSatellites.get(name);
  if (existing) {
    existing.entity.position = new Cesium.ConstantPositionProperty(cartesian);
    existing.satrec = satrec;
  }
}

async function pollCelestrakLayer(): Promise<void> {
  try {
    if (!navigator.onLine) {
      setHealth('Netzwerk: offline • Celestrak Poll pausiert');
      return;
    }

    // Kostenfrei weil Free-Tier / GitHub Student Pack
    const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle');
    if (response.status === 429) {
      setHealth('Rate-Limit Celestrak erkannt • nächster Poll verzögert');
      return;
    }

    if (!response.ok) {
      throw new Error(`Celestrak Fehler: ${response.status}`);
    }

    const tleText = await response.text();
    const lines = tleText.split('\n').map((line) => line.trim()).filter(Boolean);
    const maxSatellites = Math.min(24, Math.floor(lines.length / 3));

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

    setStatus('Live-Satelliten aktualisiert (Celestrak Free Feed).');
    setHealth('Netzwerk: online • Celestrak ok');
    viewer.scene.requestRender();
  } catch (error) {
    console.warn('Celestrak Polling fehlgeschlagen', error);
    setHealth('Netzwerk: degradiert • Celestrak temporär nicht erreichbar');
  }
}

async function pollAdsbLayer(): Promise<void> {
  try {
    if (!navigator.onLine) {
      setHealth('Netzwerk: offline • ADS-B Poll pausiert');
      return;
    }

    const adsbFallbackUrl =
      (import.meta.env.VITE_ADSB_FALLBACK_URL as string | undefined) ??
      'https://opendata.adsb.fi/api/v2/lat/24/lon/44/dist/220';

    // Kostenfrei weil Free-Tier / GitHub Student Pack
    // OpenSky free endpoint mit niedriger Poll-Frequenz.
    let response = await fetch('https://opensky-network.org/api/states/all?lamin=24&lomin=44&lamax=40&lomax=64');
    let data: {
      states?: Array<(string | number | null)[]>;
    };

    if (response.status === 429) {
      setHealth('OpenSky Rate-Limit • nutze ADS-B Fallback');
      response = await fetch(adsbFallbackUrl);
    }

    if (!response.ok) {
      throw new Error(`ADS-B Feed Fehler: ${response.status}`);
    }

    const rawData = (await response.json()) as {
      states?: Array<(string | number | null)[]>;
      aircraft?: Array<{
        hex?: string;
        lat?: number;
        lon?: number;
        alt_baro?: number;
        flight?: string;
      }>;
    };

    if (Array.isArray(rawData.states)) {
      data = { states: rawData.states };
    } else if (Array.isArray(rawData.aircraft)) {
      data = {
        states: rawData.aircraft.map((entry) => [
          entry.hex ?? 'na',
          entry.flight ?? 'UNKNOWN',
          null,
          null,
          null,
          entry.lon ?? null,
          entry.lat ?? null,
          entry.alt_baro ?? 0,
          null,
          null
        ])
      };
    } else {
      data = { states: [] };
    }

    layerCollections.adsb.entities.removeAll();
    const maxFlights = 120;
    const states = data.states ?? [];

    for (let i = 0; i < Math.min(states.length, maxFlights); i += 1) {
      const state = states[i];
      const callsign = String(state[1] ?? 'UNKNOWN').trim();
      const lon = Number(state[5]);
      const lat = Number(state[6]);
      const altitude = Number(state[7] ?? 0);

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }

      layerCollections.adsb.entities.add({
        id: `adsb-live-${callsign}-${i}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
        point: {
          pixelSize: 4,
          color: Cesium.Color.CYAN
        },
        label: {
          text: callsign,
          font: '9pt monospace',
          fillColor: Cesium.Color.CYAN,
          pixelOffset: new Cesium.Cartesian2(8, -8),
          show: false
        }
      });
    }

    setStatus('Live ADS-B aktualisiert (OpenSky Free Feed).');
    setHealth('Netzwerk: online • ADS-B ok');
    viewer.scene.requestRender();
  } catch (error) {
    console.warn('ADS-B Polling fehlgeschlagen', error);
    setHealth('Netzwerk: degradiert • ADS-B Feed temporär nicht erreichbar');
  }
}

function buildAisFallbackLayer(): void {
  layerCollections.ais.entities.removeAll();
  const fallbackShips = [
    { id: 'ais-1', lon: 56.35, lat: 26.5, speed: 0.03 },
    { id: 'ais-2', lon: 56.45, lat: 26.25, speed: 0.02 },
    { id: 'ais-3', lon: 56.65, lat: 26.0, speed: 0.025 }
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
        image: 'https://cdn.jsdelivr.net/gh/cesiumlab/aircraft-icons@main/ship-white.png',
        scale: 0.38
      },
      path: {
        resolution: 120,
        width: 1,
        leadTime: 900,
        trailTime: 900,
        material: Cesium.Color.WHITE.withAlpha(0.7)
      }
    });
  });
}

function buildJammingLayerFromReplay(): void {
  layerCollections.jamming.entities.removeAll();

  layerCollections.jamming.entities.add({
    id: 'jamming-hormuz',
    position: Cesium.Cartesian3.fromDegrees(56.2, 26.0, 1000),
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        55.8, 26.2,
        56.5, 26.2,
        56.6, 25.8,
        55.9, 25.8
      ]),
      material: Cesium.Color.RED.withAlpha(0.2),
      outline: true,
      outlineColor: Cesium.Color.RED
    },
    label: {
      text: 'GPS Jamming Zone',
      font: '11pt monospace',
      fillColor: Cesium.Color.RED
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
      float scan = sin(uv.y * 1300.0) * 0.08 * u_intensity;
      float vignette = smoothstep(0.95, 0.2, distance(uv, vec2(0.5)));
      vec3 crt = color.rgb * (1.0 - 0.18 * u_intensity) + vec3(scan);
      crt *= mix(1.0, vignette, 0.45 * u_intensity);
      fragColor = vec4(crt, color.a);
    }
  `,
  uniforms: {
    u_intensity: 0.65
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
      float noise = (random(uv * 1200.0) - 0.5) * 0.10 * u_intensity;
      vec3 nvg = vec3(0.05, 1.0, 0.22) * (luma + noise + 0.08 * u_intensity);
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
      float thermal = pow(luma, mix(1.4, 0.55, u_intensity));
      vec3 flir = heatRamp(clamp(thermal, 0.0, 1.0));
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
  crtStage.uniforms.u_intensity = intensity;
  nvgStage.uniforms.u_intensity = intensity;
  flirStage.uniforms.u_intensity = intensity;
  viewer.scene.requestRender();
}

function setShaderMode(mode: ShaderMode): void {
  activeShaderMode = mode;

  const shadersEnabled = layerState.shaders;
  crtStage.enabled = shadersEnabled && mode === 'crt';
  nvgStage.enabled = shadersEnabled && mode === 'nvg';
  flirStage.enabled = shadersEnabled && mode === 'flir';

  const modeLabel = mode === 'none' ? 'AUS' : mode.toUpperCase();
  setStatus(`Shader: ${shadersEnabled ? modeLabel : 'deaktiviert (Layer aus)'}`);
  viewer.scene.requestRender();
}

function setLayerVisibility(layer: string, visible: boolean): void {
  layerState[layer] = visible;

  if (layer === 'shaders') {
    setShaderMode(activeShaderMode);
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

  setStatus(`Layer ${layer.toUpperCase()}: ${visible ? 'aktiv' : 'aus'}`);
  viewer.scene.requestRender();
}

function flyToPreset(preset: CameraPresetKey): void {
  const view = cameraPresets[preset];
  setStatus(`Kamera springt zu: ${preset.toUpperCase()}`);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height),
    orientation: {
      heading: Cesium.Math.toRadians(view.heading),
      pitch: Cesium.Math.toRadians(view.pitch),
      roll: 0
    },
    duration: 2.2
  });
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
    });
  });

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

  if (exportReplayButton) {
    exportReplayButton.addEventListener('click', () => {
      downloadReplayExport();
    });
  }

  window.addEventListener('online', () => {
    setHealth('Netzwerk: online');
    void pollCelestrakLayer();
    void pollAdsbLayer();
  });

  window.addEventListener('offline', () => {
    setHealth('Netzwerk: offline • Live-Feeds pausiert');
  });
}

async function addGooglePhotorealisticTiles(): Promise<void> {
  try {
    // Kostenfrei weil Free-Tier / GitHub Student Pack
    const googleTileset = await Cesium.createGooglePhotorealistic3DTileset();
    viewer.scene.primitives.add(googleTileset);
    setStatus('Google Photorealistic 3D Tiles aktiv (Cesium Helper).');
  } catch (error) {
    const googleApiKey = import.meta.env.VITE_GOOGLE_MAP_TILES_KEY as string | undefined;
    if (!googleApiKey) {
      console.error('Google Photorealistic 3D Tiles konnten nicht geladen werden.', error);
      setStatus('Fehler: Google Tiles nicht geladen. API-Key fehlt.');
      return;
    }

    // Kostenfrei weil Free-Tier / GitHub Student Pack
    const fallbackTileset = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleApiKey}`,
      {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 2
      }
    );

    viewer.scene.primitives.add(fallbackTileset);
    setStatus('Google Photorealistic 3D Tiles aktiv (direkte Google API).');
  }

  flyToPreset('hormuz');
}

function startRateLimitedPollers(): void {
  if (!navigator.onLine) {
    setHealth('Netzwerk: offline • Poller im Standby');
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
}

bindToolbarEvents();
setShaderMode('none');
setShaderIntensity(0.65);
buildAisFallbackLayer();
buildJammingLayerFromReplay();
setStatus('Viewer initialisiert. Lade Google 3D Tiles…');
setHealth(navigator.onLine ? 'Netzwerk: online' : 'Netzwerk: offline');
void loadReplayData();
startRateLimitedPollers();
void addGooglePhotorealisticTiles();
