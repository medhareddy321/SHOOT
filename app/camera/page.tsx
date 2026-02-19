'use client';

/**
 * Camera page — same flow as prodhacks-image-recognition:
 * upload pose image → extract skeleton → match on camera → Take picture (share/download).
 * No auto-capture, rear camera default, mobile viewport scaling.
 */

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ---- Types (MediaPipe landmarks are normalized 0–1) ----
type Landmark = { x: number; y: number; z?: number; visibility?: number };
type PoseLandmarks = Landmark[] | null;

// ---- Scoring & success (same as image-recognition) ----
const KEY_LANDMARK_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26] as const;
const SUCCESS_THRESHOLD = 83;
const SUCCESS_HOLD_FRAMES = 4;
const MIN_VISIBLE_LANDMARKS = 5;
const CAM_W = 640;
const CAM_H = 480;

// ---- Position/distance guidance (only when match < GUIDANCE_MAX_MATCH) ----
const GUIDANCE_MAX_MATCH = 50;
const CENTER_LEFT = 0.38;
const CENTER_RIGHT = 0.62;
const SHOULDER_WIDTH_TOO_BIG = 0.42;
const SHOULDER_WIDTH_TOO_SMALL = 0.16;

/** Position/distance hint from live pose (mirror-friendly). */
function getGuidancePrompt(live: PoseLandmarks): string | null {
  if (!live?.length) return null;
  const L = 11, R = 12;
  const l = live[L], r = live[R];
  if (!l || !r) return null;
  const centerX = (l.x + r.x) / 2;
  const dx = r.x - l.x, dy = r.y - l.y;
  const shoulderWidth = Math.sqrt(dx * dx + dy * dy);
  if (centerX < CENTER_LEFT) return 'Move left';
  if (centerX > CENTER_RIGHT) return 'Move right';
  if (shoulderWidth > SHOULDER_WIDTH_TOO_BIG) return 'Back up';
  if (shoulderWidth < SHOULDER_WIDTH_TOO_SMALL) return 'Come closer';
  return null;
}

/** Match score 0–100 in letterbox space. */
function computeMatchScore(
  template: PoseLandmarks,
  live: PoseLandmarks,
  templateImageSize: { width: number; height: number } | null
): number {
  if (!template || !live) return 0;
  const A_c = CAM_W / CAM_H;
  const A_t = templateImageSize ? templateImageSize.width / templateImageSize.height : A_c;
  let boxX: number, boxY: number, boxW: number, boxH: number;
  if (A_t < A_c) {
    boxH = CAM_H;
    boxW = CAM_H * A_t;
    boxX = (CAM_W - boxW) / 2;
    boxY = 0;
  } else {
    boxW = CAM_W;
    boxH = CAM_W / A_t;
    boxX = 0;
    boxY = (CAM_H - boxH) / 2;
  }
  let total = 0;
  let count = 0;
  for (const i of KEY_LANDMARK_INDICES) {
    const t = template[i];
    const l = live[i];
    const tVis = t?.visibility ?? 1;
    const lVis = l?.visibility ?? 1;
    if (!t || !l || tVis < 0.5 || lVis < 0.5) continue;
    const lx = (l.x * CAM_W - boxX) / boxW;
    const ly = (l.y * CAM_H - boxY) / boxH;
    const dx = t.x - lx;
    const dy = t.y - ly;
    total += Math.sqrt(dx * dx + dy * dy);
    count++;
  }
  if (count < MIN_VISIBLE_LANDMARKS) return 0;
  const avgDistance = total / count;
  const normalized = Math.min(1, avgDistance / 0.42);
  return Math.round(100 * (1 - normalized));
}

/** Draws template pose as a semi-transparent stickman. Green glow when aligned. (Non-mirrored for rear camera.) */
function drawGhostStickman(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  canvasWidth: number,
  canvasHeight: number,
  aligned = false
): void {
  const pt = (i: number) => {
    const l = landmarks[i];
    if (!l) return null;
    return { x: l.x * canvasWidth, y: l.y * canvasHeight };
  };

  const p11 = pt(11), p12 = pt(12), p13 = pt(13), p14 = pt(14), p15 = pt(15), p16 = pt(16);
  const p23 = pt(23), p24 = pt(24), p25 = pt(25), p26 = pt(26), p27 = pt(27), p28 = pt(28);

  ctx.save();
  if (aligned) {
    ctx.strokeStyle = 'rgba(192,192,212,0.9)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(220,220,255,0.95)';
    ctx.shadowBlur = 28;
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.4)';
    ctx.shadowBlur = 15;
  }

  if (p11 && p12) { ctx.beginPath(); ctx.moveTo(p11.x, p11.y); ctx.lineTo(p12.x, p12.y); ctx.stroke(); }
  if (p11 && p13) { ctx.beginPath(); ctx.moveTo(p11.x, p11.y); ctx.lineTo(p13.x, p13.y); ctx.stroke(); }
  if (p13 && p15) { ctx.beginPath(); ctx.moveTo(p13.x, p13.y); ctx.lineTo(p15.x, p15.y); ctx.stroke(); }
  if (p12 && p14) { ctx.beginPath(); ctx.moveTo(p12.x, p12.y); ctx.lineTo(p14.x, p14.y); ctx.stroke(); }
  if (p14 && p16) { ctx.beginPath(); ctx.moveTo(p14.x, p14.y); ctx.lineTo(p16.x, p16.y); ctx.stroke(); }
  if (p11 && p12 && p23 && p24) {
    const midShoulder = { x: (p11.x + p12.x) / 2, y: (p11.y + p12.y) / 2 };
    const midHip = { x: (p23.x + p24.x) / 2, y: (p23.y + p24.y) / 2 };
    ctx.beginPath(); ctx.moveTo(midShoulder.x, midShoulder.y); ctx.lineTo(midHip.x, midHip.y); ctx.stroke();
  }
  if (p23 && p24) { ctx.beginPath(); ctx.moveTo(p23.x, p23.y); ctx.lineTo(p24.x, p24.y); ctx.stroke(); }
  if (p23 && p25) { ctx.beginPath(); ctx.moveTo(p23.x, p23.y); ctx.lineTo(p25.x, p25.y); ctx.stroke(); }
  if (p25 && p27) { ctx.beginPath(); ctx.moveTo(p25.x, p25.y); ctx.lineTo(p27.x, p27.y); ctx.stroke(); }
  if (p24 && p26) { ctx.beginPath(); ctx.moveTo(p24.x, p24.y); ctx.lineTo(p26.x, p26.y); ctx.stroke(); }
  if (p26 && p28) { ctx.beginPath(); ctx.moveTo(p26.x, p26.y); ctx.lineTo(p28.x, p28.y); ctx.stroke(); }
  if (p11 && p12) {
    const midX = (p11.x + p12.x) / 2;
    const midY = (p11.y + p12.y) / 2;
    const headOffsetY = 0.12 * canvasHeight;
    const headRadius = 0.06 * Math.min(canvasWidth, canvasHeight);
    ctx.beginPath(); ctx.arc(midX, midY - headOffsetY, headRadius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/** Circular progress ring (same as image-recognition). */
function CircularMatchProgress({ score, threshold }: { score: number; threshold: number }) {
  const size = 32;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = score >= threshold ? 100 : (score / threshold) * 100;
  const offset = circumference * (1 - progress / 100);

  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={score >= threshold ? 'rgba(52,211,153,0.9)' : 'rgba(255,255,255,0.75)'}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}

/** Downscale image to max 640 on longest edge, send to pose. */
async function sendImageToPose(pose: InstanceType<typeof import('@mediapipe/pose').Pose>, img: HTMLImageElement) {
  const maxSize = 640;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context missing');
  ctx.drawImage(img, 0, 0, w, h, 0, 0, cw, ch);
  await pose.send({ image: canvas });
}

type Step = 'upload' | 'camera';

function CameraPageContent() {
  console.log('=== CAMERA PAGE RENDER ===');
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const initialStep: Step = 'upload';
  console.log('Initializing step:', initialStep);
  const [step, setStep] = useState<Step>(initialStep);
  const [templatePose, setTemplatePose] = useState<PoseLandmarks>(null);
  const [templateImageUrl, setTemplateImageUrl] = useState<string | null>(null);
  const [templateImageSize, setTemplateImageSize] = useState<{ width: number; height: number } | null>(null);
  const [templateImage, setTemplateImage] = useState<HTMLImageElement | null>(null);
  const [livePose, setLivePose] = useState<PoseLandmarks>(null);
  const [matchScore, setMatchScore] = useState(0);
  const [camError, setCamError] = useState<string | null>(null);
  const [isCamActive, setIsCamActive] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [guidancePrompt, setGuidancePrompt] = useState<string | null>(null);
  const [displaySuccess, setDisplaySuccess] = useState(false);
  const [poseNameOverride, setPoseNameOverride] = useState<string | null>(null);

  const successHoldCountRef = useRef(0);
  const poseRef = useRef<InstanceType<typeof import('@mediapipe/pose').Pose> | null>(null);
  const modeRef = useRef<'template' | 'live'>('template');
  const cameraRef = useRef<InstanceType<typeof import('@mediapipe/camera_utils').Camera> | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const drawAnimationRef = useRef<number>(0);
  const [cameraControls, setCameraControls] = useState<{
    zoom?: { min: number; max: number; step: number };
    exposureCompensation?: { min: number; max: number; step: number };
  }>({});
  const [zoomValue, setZoomValue] = useState(1);
  const [exposureValue, setExposureValue] = useState(0);
  const drawingUtilsRef = useRef<{
    drawConnectors: (ctx: CanvasRenderingContext2D, landmarks: Landmark[], connections: [number, number][], options?: object) => void;
    drawLandmarks: (ctx: CanvasRenderingContext2D, landmarks: Landmark[], options?: object) => void;
    POSE_CONNECTIONS: [number, number][];
  } | null>(null);
  const previousScoreRef = useRef(0);
  const poseInitializedRef = useRef(false);

  // Start camera with resolution fallback
  const startCameraWithFallback = useCallback(async () => {
    if (!videoRef.current) return;
    const { Camera } = await import('@mediapipe/camera_utils');
    const resolutions = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 640, height: 480 },
    ];
    for (const { width, height } of resolutions) {
      try {
        console.log(`Trying to start camera at ${width}x${height}...`);
        const cam = new Camera(videoRef.current, {
          onFrame: async () => {
            if (poseRef.current && videoRef.current) {
              await poseRef.current.send({ image: videoRef.current });
            }
          },
          width,
          height,
          facingMode: 'environment', // rear camera on mobile
        });
        await cam.start();
        cameraRef.current = cam;
        setIsCamActive(true);
        setCamError(null);
        console.log(`✅ Camera started successfully at ${width}x${height}`);
        return;
      } catch (err) {
        console.log(`❌ Failed at ${width}x${height}:`, err);
      }
    }
    console.error('❌ Could not start camera at any resolution');
  }, []);

  // Stop camera during template extraction; restart after.
  const pauseCameraForTemplate = useCallback(async () => {
    if (cameraRef.current) {
      console.log('⏸️ Pausing camera for template extraction');
      try {
        await cameraRef.current.stop();
      } catch (err) {
        console.warn('Pause camera error:', err);
      }
      setIsCamActive(false);
    }
  }, []);

  const resumeCameraAfterTemplate = useCallback(async () => {
    if (step === 'camera') {
      console.log('▶️ Resuming camera');
      await startCameraWithFallback();
    }
  }, [step, startCameraWithFallback]);

  useEffect(() => {
    console.log('Initial step state:', step);
  }, []); // run once on mount

  useEffect(() => {
    console.log('Step changed to:', step);
  }, [step]);

  /** EMA (alpha=0.2) over raw score for stable display. */
  const getSmoothedScore = useCallback((rawScore: number) => {
    const alpha = 0.2;
    const smoothed = alpha * rawScore + (1 - alpha) * previousScoreRef.current;
    previousScoreRef.current = smoothed;
    return Math.round(smoothed);
  }, []);

  // Debug: log initial state on mount
  useEffect(() => {
    console.log('Camera page mounted, initial step:', step);
    const selectedPoseData = typeof window !== 'undefined' ? sessionStorage.getItem('selectedPose') : null;
    if (selectedPoseData && step === 'upload') {
      const poseData = JSON.parse(selectedPoseData);
      console.log('🎯 Auto-loading pose from Browse/Saved:', poseData);
      sessionStorage.removeItem('selectedPose');
      modeRef.current = 'template';
      setExtracting(true);
      setTemplatePose(null);
      setTemplateImageSize(null);
      setPoseNameOverride(poseData.name ?? 'Pose');
      setTemplateImageUrl(poseData.imageUrl ?? null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const maxSize = 640;
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
          const cw = Math.floor(img.width * scale);
          const ch = Math.floor(img.height * scale);
          console.log('📐 Downscaled from', img.width, 'x', img.height, 'to', cw, 'x', ch);
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No canvas ctx');
          ctx.drawImage(img, 0, 0, cw, ch);
          // wait for poseRef ready
          let attempts = 0;
          while (!poseRef.current && attempts < 50) {
            console.log('⏳ Waiting for MediaPipe... attempt', attempts);
            await new Promise((r) => setTimeout(r, 100));
            attempts++;
          }
          if (!poseRef.current) throw new Error('MediaPipe not ready');
          setTemplateImageSize({ width: img.naturalWidth, height: img.naturalHeight });
          setTemplateImage(img);
          setTemplatePose(null);
          console.log('🔄 Mode set to: template');
          await pauseCameraForTemplate();
          await poseRef.current.send({ image: canvas });
          console.log('✅ Sent to MediaPipe, waiting for results...');
          await resumeCameraAfterTemplate();
        } catch (err) {
          console.error('❌ Auto-load template failed:', err);
          setExtracting(false);
        }
      };
      img.onerror = (err) => {
        console.error('❌ Auto-load image failed:', err);
        setExtracting(false);
      };
      img.src = poseData.imageUrl;
    }
  }, [pauseCameraForTemplate, resumeCameraAfterTemplate, step]); // run once

  // Init MediaPipe Pose and drawing utils once. Single onResults handler that routes by mode.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      console.log('Initializing MediaPipe Pose...');
      const { Pose, POSE_CONNECTIONS } = await import('@mediapipe/pose');
      const { drawConnectors, drawLandmarks } = await import('@mediapipe/drawing_utils');
      if (cancelled) return;
      drawingUtilsRef.current = { drawConnectors, drawLandmarks, POSE_CONNECTIONS };

      const pose = new Pose({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`,
      });
      pose.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      const handleResults = (results: import('@mediapipe/pose').Results) => {
        if (cancelled) return;
        const landmarks = results.poseLandmarks ?? null;
        if (modeRef.current === 'template') {
          console.log('📊 MediaPipe results received, mode: template, landmarks:', !!landmarks);
          setTemplatePose(landmarks ? [...landmarks] : null);
          setExtracting(false);
          if (landmarks) {
            console.log('✅ Template pose extracted successfully');
            modeRef.current = 'live';
            console.log('🔄 Mode switched to: live');
          } else {
            console.error('❌ No landmarks detected in template image');
          }
        } else {
          console.log('📊 MediaPipe results received, mode: live, landmarks:', !!landmarks);
          setLivePose(landmarks ? [...landmarks] : null);
        }
      };

      pose.onResults(handleResults);
      poseRef.current = pose;
      poseInitializedRef.current = true;
      console.log('MediaPipe Pose initialized');
    })();
    return () => {
      cancelled = true;
      poseRef.current = null;
    };
  }, []);

  // Auto-load pose from Browse (poseId) when ready.
  // Removed legacy poseId deep-linking

  // Auto-load pose from Saved (savedId) when provided.
  // Removed legacy savedId deep-linking

  // Draw preview when in upload step with template pose.
  useEffect(() => {
    if (step !== 'upload' || !templateImageUrl || !templatePose?.length) return;
    const canvas = previewCanvasRef.current;
    const utils = drawingUtilsRef.current;
    if (!canvas || !utils) return;

    const img = new Image();
    img.onload = () => {
      if (!templateImageSize) {
        setTemplateImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      }
      const maxW = 640;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
      utils.drawConnectors(ctx, templatePose, utils.POSE_CONNECTIONS, {
        color: 'rgba(128,128,128,0.9)', lineWidth: 3,
      });
      utils.drawLandmarks(ctx, templatePose, {
        color: 'rgba(128,128,128,0.9)', lineWidth: 1, fillColor: 'rgba(80,80,80,0.9)', radius: 5,
      });
    };
    img.src = templateImageUrl;
  }, [step, templateImageUrl, templatePose, templateImageSize]);

  // No auto-switch from deep links; browse/saved now use upload flow via sessionStorage.

  // Draw video + ghost template + live skeleton.
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const Cw = video.videoWidth || 640;
    const Ch = video.videoHeight || 480;
    if (canvas.width !== Cw || canvas.height !== Ch) {
      canvas.width = Cw;
      canvas.height = Ch;
    }
    ctx.clearRect(0, 0, Cw, Ch);

    const A_c = Cw / Ch;
    const size = templateImageSize;
    const A_t = size ? size.width / size.height : A_c;

    let boxX: number, boxY: number, boxW: number, boxH: number;
    if (A_t < A_c) {
      boxH = Ch; boxW = Ch * A_t; boxX = (Cw - boxW) / 2; boxY = 0;
    } else {
      boxW = Cw; boxH = Cw / A_t; boxX = 0; boxY = (Ch - boxH) / 2;
    }

    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const scl = Math.max(boxW / vW, boxH / vH);
    const sW = boxW / scl;
    const sH = boxH / scl;
    const sx = (vW - sW) / 2;
    const sy = (vH - sH) / 2;
    ctx.drawImage(video, sx, sy, sW, sH, boxX, boxY, boxW, boxH);

    const utils = drawingUtilsRef.current;
    const { drawConnectors, drawLandmarks, POSE_CONNECTIONS } = utils ?? {};
    if (!drawConnectors || !drawLandmarks || !POSE_CONNECTIONS) {
      drawAnimationRef.current = requestAnimationFrame(draw);
      return;
    }

    ctx.save();
    ctx.translate(boxX, boxY);
    ctx.scale(boxW, boxH);
    ctx.scale(1 / Cw, 1 / Ch);

    if (templatePose?.length) {
      drawGhostStickman(ctx, templatePose, Cw, Ch, matchScore >= SUCCESS_THRESHOLD);
    }
    ctx.restore();

    drawAnimationRef.current = requestAnimationFrame(draw);
  }, [templatePose, templateImageSize, matchScore]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isCamActive) return;
    const onPlay = () => draw();
    video.addEventListener('play', onPlay);
    if (video.readyState >= 2) draw();
    return () => {
      video.removeEventListener('play', onPlay);
      if (drawAnimationRef.current) cancelAnimationFrame(drawAnimationRef.current);
    };
  }, [isCamActive, draw]);

  /** Capture raw video frame (no overlay) — share or download, same as image-recognition. */
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `pose-capture-${Date.now()}.png`, { type: 'image/png' });
        if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
          navigator.share({ files: [file], title: 'Pose capture' }).catch(() => {
            downloadBlob(blob);
          });
        } else {
          downloadBlob(blob);
        }
      },
      'image/png'
    );
  }, []);

  function downloadBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pose-capture-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Scoring + guidance + displaySuccess (same as image-recognition)
  useEffect(() => {
    const rawScore = computeMatchScore(templatePose, livePose, templateImageSize);
    const smoothedScore = getSmoothedScore(rawScore);
    setMatchScore(smoothedScore);
    if (smoothedScore >= SUCCESS_THRESHOLD) {
      successHoldCountRef.current += 1;
      if (successHoldCountRef.current >= SUCCESS_HOLD_FRAMES) {
        setDisplaySuccess(true);
      }
      setGuidancePrompt(null);
    } else {
      successHoldCountRef.current = 0;
      setDisplaySuccess(false);
      if (smoothedScore < GUIDANCE_MAX_MATCH && livePose) {
        setGuidancePrompt(getGuidancePrompt(livePose));
      } else {
        setGuidancePrompt(null);
      }
    }
  }, [templatePose, livePose, templateImageSize, getSmoothedScore]);

  // Start webcam when entering camera step (works for both deep link and manual).
  useEffect(() => {
    console.log('Camera start effect - step:', step, 'videoRef exists:', !!videoRef.current, 'camera already started:', !!cameraRef.current);
    if (step === 'camera' && videoRef.current && !cameraRef.current) {
      console.log('ATTEMPTING TO START CAMERA NOW');
      startCameraWithFallback();
    } else {
      console.log('Camera NOT starting - step:', step, 'videoRef:', !!videoRef.current, 'cameraRef:', !!cameraRef.current);
    }

    return () => {
      try { if (cameraRef.current) cameraRef.current.stop(); } catch { /* ignore */ }
      cameraRef.current = null;
      videoTrackRef.current = null;
      setIsCamActive(false);
      setCameraControls({});
    };
  }, [step, startCameraWithFallback]);

  // Read zoom/exposure capabilities from the video track when camera is active (not supported on iOS Safari).
  useEffect(() => {
    if (!isCamActive) return;
    const video = videoRef.current;
    if (!video) return;
    const tryAttach = () => {
      const stream = video.srcObject as MediaStream | null;
      if (!stream) return false;
      const track = stream.getVideoTracks()[0];
      if (!track) return false;
      videoTrackRef.current = track;
      const cap = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number }; exposureCompensation?: { min: number; max: number; step: number } };
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number; exposureCompensation?: number };
      const controls: typeof cameraControls = {};
      if (typeof cap.zoom === 'object' && cap.zoom?.min != null && cap.zoom?.max != null) {
        controls.zoom = { min: cap.zoom.min, max: cap.zoom.max, step: cap.zoom.step ?? 0.1 };
        setZoomValue(settings.zoom ?? 1);
      }
      if (typeof cap.exposureCompensation === 'object' && cap.exposureCompensation?.min != null && cap.exposureCompensation?.max != null) {
        controls.exposureCompensation = { min: cap.exposureCompensation.min, max: cap.exposureCompensation.max, step: cap.exposureCompensation.step ?? 0.1 };
        setExposureValue(settings.exposureCompensation ?? 0);
      }
      setCameraControls(controls);
      return true;
    };
    if (tryAttach()) return;
    const t = setTimeout(tryAttach, 800);
    return () => clearTimeout(t);
  }, [isCamActive]);

  const onZoomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setZoomValue(v);
    const track = videoTrackRef.current;
    if (!track) return;
    track.applyConstraints({ advanced: [{ zoom: v }] } as unknown as MediaTrackConstraints).catch(() => {});
  }, []);

  const onExposureChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setExposureValue(v);
    const track = videoTrackRef.current;
    if (!track) return;
    track.applyConstraints({ advanced: [{ exposureCompensation: v }] } as unknown as MediaTrackConstraints).catch(() => {});
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !poseRef.current) return;
    modeRef.current = 'template';
    setExtracting(true);
    setTemplatePose(null);
    setTemplateImageSize(null);
    const prevUrl = templateImageUrl;
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    const url = URL.createObjectURL(file);
    setTemplateImageUrl(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      if (!poseRef.current) return;
      try {
        await sendImageToPose(poseRef.current, img);
      } catch {
        setExtracting(false);
      }
    };
    img.src = url;
    e.target.value = '';
  }, [templateImageUrl]);

  const handleProceed = useCallback(() => {
    if (!templatePose) return;
    modeRef.current = 'live';
    setStep('camera');
  }, [templatePose]);

  const handleBack = useCallback(() => {
    modeRef.current = 'template';
    if (step === 'camera') {
      setStep('upload');
    } else {
      router.push('/');
    }
  }, [step, router]);

  return (
    <div
      className="flex flex-col bg-black text-white overflow-hidden"
      style={{ minHeight: 'var(--vvh, 100dvh)', maxHeight: 'var(--vvh, 100dvh)', height: 'var(--vvh, 100dvh)' }}
    >
      {step === 'upload' && (
        <>
          <header className="flex-none px-4 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-sm text-white/60 hover:text-white/80">
                ← Browse
              </Link>
            </div>
            <h1 className="text-lg font-semibold mt-2">
              Choose a pose image
            </h1>
            <p className="text-sm text-white/60 mt-0.5">
              We'll extract the body joints, then you can match it with your camera.
            </p>
            <p className="text-xs text-white/40 mt-1">
              All processing happens on-device. Make sure everyone in frame consents before you shoot.
            </p>
          </header>
          <main className="flex-1 flex flex-col items-center justify-center p-4 overflow-auto">
            <label className="w-full max-w-sm cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={onFileChange}
                className="sr-only"
              />
              <span className="block w-full py-3 px-4 rounded-xl bg-white/10 text-center text-sm font-medium border border-white/20 hover:bg-white/15 transition-colors">
                {templateImageUrl ? 'Pick a different image' : 'Upload your own pose'}
              </span>
            </label>

            {extracting && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <p className="text-sm text-white/60">Extracting pose...</p>
              </div>
            )}

            {templateImageUrl && templatePose && !extracting && (
              <div className="mt-6 w-full max-w-lg flex flex-col items-center">
                <p className="text-sm text-white/70 mb-2">Extracted pose (key joints):</p>
                <div className="relative w-full rounded-xl overflow-hidden bg-black/50" style={{ aspectRatio: '1' }}>
                  <canvas
                    ref={previewCanvasRef}
                    className="w-full h-full object-contain"
                    style={{ maxHeight: '70vh' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleProceed}
                  className="mt-6 w-full max-w-sm py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-lg transition-colors"
                >
                  Start matching
                </button>
              </div>
            )}

            {templateImageUrl && !templatePose && !extracting && (
              <p className="mt-4 text-sm text-amber-400">No pose detected. Try another image.</p>
            )}
          </main>
        </>
      )}

      {step === 'camera' && (
        <>
          <main
            className="flex-1 min-h-0 relative bg-[#1a1a1b] overflow-hidden"
            style={{ minHeight: 'var(--vvh, 100dvh)', maxHeight: 'var(--vvh, 100dvh)', height: 'var(--vvh, 100dvh)' }}
          >
            {/* Camera with subtle dark tint (same as image-recognition) */}
            <div className="absolute inset-0 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
              <div className="absolute inset-0 bg-[#1a1a1b]/20 pointer-events-none" aria-hidden />
            </div>

            {/* Top bar: Back + Match pill (Pinterest-style, same as image-recognition) */}
            <div
              className="absolute top-0 left-0 right-0 flex items-center justify-between px-3"
              style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
            >
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 py-2 px-3 rounded-full text-[13px] font-medium text-white/85 hover:text-white transition-colors"
              >
                <span className="opacity-80">←</span> Back
              </button>
              <div className="flex items-center gap-2.5 py-1.5 px-3 rounded-full bg-black/35 backdrop-blur-md border border-white/[0.08]">
                <CircularMatchProgress score={matchScore} threshold={SUCCESS_THRESHOLD} />
                <span className="text-[13px] text-white/70">Match</span>
                <span className="text-[15px] font-semibold tabular-nums text-white/95 min-w-[2.25rem]">
                  {matchScore}%
                </span>
                {displaySuccess && (
                  <span className="text-[11px] font-medium text-emerald-400/80 tracking-wide">
                    success
                  </span>
                )}
              </div>
              <div className="w-14" />
            </div>

            {/* Guidance pill — above bottom bar */}
            {guidancePrompt && (
              <div
                className="absolute left-0 right-0 flex justify-center pointer-events-none"
                style={{ bottom: 'max(4.5rem, calc(env(safe-area-inset-bottom) + 4rem))' }}
              >
                <span className="px-4 py-2 rounded-full bg-black/45 backdrop-blur-sm text-white/90 text-[13px] font-medium border border-white/[0.06]">
                  {guidancePrompt}
                </span>
              </div>
            )}

            {/* Bottom bar: Zoom + Exposure + Take picture (same as image-recognition) */}
            <div
              className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 px-3 py-2.5 bg-black/40 backdrop-blur-md border-t border-white/[0.06]"
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              {(cameraControls.zoom || cameraControls.exposureCompensation) && (
                <div className="flex items-center gap-3 flex-1 min-w-0 justify-center">
                  {cameraControls.zoom && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/60 uppercase tracking-wider">Zoom</span>
                      <input
                        type="range"
                        min={cameraControls.zoom.min}
                        max={cameraControls.zoom.max}
                        step={cameraControls.zoom.step}
                        value={zoomValue}
                        onChange={onZoomChange}
                        className="w-20 h-1 rounded-full accent-white/90 bg-white/20"
                      />
                    </div>
                  )}
                  {cameraControls.exposureCompensation && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/60 uppercase tracking-wider">Exp</span>
                      <input
                        type="range"
                        min={cameraControls.exposureCompensation.min}
                        max={cameraControls.exposureCompensation.max}
                        step={cameraControls.exposureCompensation.step}
                        value={exposureValue}
                        onChange={onExposureChange}
                        className="w-20 h-1 rounded-full accent-white/90 bg-white/20"
                      />
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={capturePhoto}
                className="px-5 py-2.5 rounded-full bg-white text-[#1a1a1b] font-semibold text-[13px] shadow-lg active:scale-[0.98] transition-transform shrink-0 hover:bg-white/95"
              >
                Take picture
              </button>
            </div>

            {/* Camera error */}
            {camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1b]/90 backdrop-blur-sm p-4 text-center text-[13px] text-white/90">
                {camError}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}

export default function PoseMatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <CameraPageContent />
    </Suspense>
  );
}
