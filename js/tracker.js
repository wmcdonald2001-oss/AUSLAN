// Camera capture and hand tracking using MediaPipe Hand Landmarker.

const MEDIAPIPE_VERSION = '1.0.1';
const MEDIAPIPE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let visionPromise = null;

function loadVision() {
  visionPromise ??= (async () => {
    const { FilesetResolver, HandLandmarker } = await import(`${MEDIAPIPE_URL}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_URL}/wasm`);
    return { fileset, HandLandmarker };
  })();
  visionPromise.catch(() => (visionPromise = null)); // allow retry after a network failure
  return visionPromise;
}

// On machines without graphics acceleration the browser emulates the GPU in
// software, which makes MediaPipe's GPU mode about 10x slower than its CPU mode.
function hasHardwareGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    return !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

// runningMode is 'VIDEO' for the live camera, 'IMAGE' for stepping through video files.
export async function createHandLandmarker(runningMode) {
  const { fileset, HandLandmarker } = await loadVision();
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  if (!hasHardwareGpu()) return HandLandmarker.createFromOptions(fileset, options('CPU'));
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

export class HandTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.landmarker = null;
    this.connections = [];
    this.stream = null;
    this.facingMode = 'user';
    this.running = false;
    this.onframe = null; // (result) => void
    this.lastVideoTime = -1;
  }

  async load() {
    const { HandLandmarker } = await loadVision();
    this.landmarker = await createHandLandmarker('VIDEO');
    this.connections = HandLandmarker.HAND_CONNECTIONS;
  }

  async startCamera() {
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    // Mirror the selfie camera so it feels like a mirror to the signer.
    this.video.parentElement.classList.toggle('mirrored', this.facingMode === 'user');
    this.running = true;
    this.lastVideoTime = -1;
    requestAnimationFrame(() => this.loop());
  }

  stopCamera() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async switchCamera() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    await this.startCamera();
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (this.landmarker && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const result = this.landmarker.detectForVideo(v, performance.now());
      this.draw(result);
      this.onframe?.(result);
    }
    requestAnimationFrame(() => this.loop());
  }

  draw(result) {
    const { canvas, ctx, video } = this;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hands = result.landmarks ?? [];
    const handedness = result.handedness ?? result.handednesses ?? [];
    hands.forEach((hand, i) => {
      const isLeft = handedness[i]?.[0]?.categoryName === 'Left';
      const colour = isLeft ? '#38bdf8' : '#f59e0b';
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(2, canvas.width / 320);
      for (const { start, end } of this.connections) {
        const a = hand[start];
        const b = hand[end];
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      for (const p of hand) {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(2, canvas.width / 260), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
}
