'use client';

/**
 * Camera page — upload pose image OR receive poseId from browse page →
 * extract skeleton → match on camera → auto-capture on success → save to gallery.
 */

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveGalleryPhoto } from '@/lib/storage';

// ---- Types (MediaPipe landmarks are normalized 0–1) ----
type Landmark = { x: number; y: number; z?: number; visibility?: number };
type PoseLandmarks = Landmark[] | null;

// ---- Scoring & success ----
const KEY_LANDMARK_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26] as const;
const SUCCESS_THRESHOLD = 83;
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

/** Draws template pose as a semi-transparent stickman. Green glow when aligned. */
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
    return { x: (1 - l.x) * canvasWidth, y: l.y * canvasHeight };
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

/** Circular progress ring. */
function CircularMatchProgress({ score, threshold }: { score: number; threshold: number }) {
  const size = 36;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const progress = score >= threshold ? 100 : (score / threshold) * 100;
  const offset = circumference * (1 - progress / 100);

  return (
    <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={score >= threshold ? 'rgb(74,222,128)' : 'rgba(255,255,255,0.9)'}
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
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [poseNameOverride, setPoseNameOverride] = useState<string | null>(null);

  // Auto-capture state
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastCaptureType, setLastCaptureType] = useState<'auto' | 'manual' | null>(null);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const hasCapturedRef = useRef(false);
  const isCapturingRef = useRef(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoHoldStartRef = useRef<number | null>(null);
  const pendingPoseNameRef = useRef<string | null>(null);
  const pendingScoreRef = useRef<number | null>(null);
  const pendingCaptureTypeRef = useRef<'auto' | 'manual' | null>(null);

  const poseRef = useRef<InstanceType<typeof import('@mediapipe/pose').Pose> | null>(null);
  const modeRef = useRef<'template' | 'live'>('template');
  const cameraRef = useRef<InstanceType<typeof import('@mediapipe/camera_utils').Camera> | null>(null);
  const drawAnimationRef = useRef<number>(0);
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
          facingMode: 'user',
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
    if (livePose?.length) {
      const liveInBox = livePose.map((p) => ({
        ...p,
        x: (p.x * Cw - boxX) / boxW,
        y: (p.y * Ch - boxY) / boxH,
      }));
      drawConnectors(ctx, liveInBox, POSE_CONNECTIONS, { color: '#00ff00', lineWidth: 2 });
      drawLandmarks(ctx, liveInBox, { color: '#00ff00', lineWidth: 1, fillColor: '#00cc00', radius: 3 });
    }
    ctx.restore();

    drawAnimationRef.current = requestAnimationFrame(draw);
  }, [templatePose, livePose, templateImageSize, matchScore]);

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

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(null);
  }, []);

  const performCapture = useCallback(
    (captureType: 'auto' | 'manual') => {
      if (isCapturingRef.current) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

      // Build a clean frame matching the displayed letterbox (no overlays).
      const Cw = video.videoWidth;
      const Ch = video.videoHeight;
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

      const temp = document.createElement('canvas');
      temp.width = Cw;
      temp.height = Ch;
      const ctx = temp.getContext('2d');
      if (!ctx) return;

      // Mirror horizontally to match the UI (video is CSS scaleX(-1)).
      ctx.save();
      ctx.translate(temp.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sW, sH, temp.width - boxX - boxW, boxY, boxW, boxH);
      ctx.restore();

      const photoDataUrl = temp.toDataURL('image/jpeg', 0.9);

      isCapturingRef.current = true;
      hasCapturedRef.current = true;
      setCapturedPhoto(photoDataUrl);
      setLastCaptureType(captureType);

      const poseName = poseNameOverride ?? 'Custom Pose';

      // Defer saving until user confirms.
      pendingPoseNameRef.current = poseName;
      pendingScoreRef.current = matchScore;
      pendingCaptureTypeRef.current = captureType;
      setShowSuccessModal(true);
    },
    [matchScore, poseNameOverride, templateImageSize]
  );

  const startCountdown = useCallback(() => {
    cancelCountdown();
    setCountdown(3);
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          cancelCountdown();
          performCapture('auto');
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [cancelCountdown, performCapture]);

  // Scoring + guidance.
  useEffect(() => {
    const rawScore = computeMatchScore(templatePose, livePose, templateImageSize);
    const smoothedScore = getSmoothedScore(rawScore);
    setMatchScore(smoothedScore);
    if (smoothedScore < GUIDANCE_MAX_MATCH && livePose) {
      setGuidancePrompt(getGuidancePrompt(livePose));
    } else {
      setGuidancePrompt(null);
    }
  }, [templatePose, livePose, templateImageSize, getSmoothedScore]);

  // Auto-capture logic (80%+ for 3s then countdown).
  useEffect(() => {
    if (!autoCaptureEnabled) {
      autoHoldStartRef.current = null;
      cancelCountdown();
      return;
    }
    if (matchScore >= 80) {
      if (!autoHoldStartRef.current) autoHoldStartRef.current = performance.now();
      const elapsed = performance.now() - (autoHoldStartRef.current ?? 0);
      if (elapsed >= 3000 && countdown === null && !isCapturingRef.current) {
        startCountdown();
      }
    } else {
      autoHoldStartRef.current = null;
      cancelCountdown();
    }
  }, [matchScore, autoCaptureEnabled, countdown, startCountdown, cancelCountdown]);

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
      setIsCamActive(false);
    };
  }, [step, startCameraWithFallback]);

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

  const handleResetCapture = useCallback(() => {
    hasCapturedRef.current = false;
    isCapturingRef.current = false;
    cancelCountdown();
    setShowSuccessModal(false);
    setCapturedPhoto(null);
    previousScoreRef.current = 0;
    setMatchScore(0);
    setLastCaptureType(null);
    setSaveInFlight(false);
    pendingPoseNameRef.current = null;
    pendingScoreRef.current = null;
    pendingCaptureTypeRef.current = null;
    modeRef.current = 'template';
  }, [cancelCountdown]);

  const handleBack = useCallback(() => {
    console.log('Back button clicked, current step:', step);
    handleResetCapture();
    modeRef.current = 'template';
    if (step === 'camera') {
      setStep('upload');
    } else {
      router.push('/');
    }
  }, [handleResetCapture, step, router]);

  const handleSaveConfirmed = useCallback(async () => {
    if (!capturedPhoto || !pendingPoseNameRef.current || pendingScoreRef.current === null || !pendingCaptureTypeRef.current) {
      handleResetCapture();
      return;
    }
    setSaveInFlight(true);
    try {
      await saveGalleryPhoto({
        poseName: pendingPoseNameRef.current,
        photoDataUrl: capturedPhoto,
        score: pendingScoreRef.current,
        captureType: pendingCaptureTypeRef.current,
      });
    } catch {
      // ignore save errors for now
    }
    setSaveInFlight(false);
    setShowSuccessModal(false);
    // keep the photo shown briefly then reset to allow new shot
    handleResetCapture();
  }, [capturedPhoto, handleResetCapture]);

  // Determine pose name for display
  const currentPoseName = poseNameOverride ?? 'Custom Pose';

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-black text-white">
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
          <header className="relative flex-none flex items-center justify-between gap-3 px-3 py-2 bg-black/70 z-10">
            <button type="button" onClick={handleBack} className="text-sm text-white/70 hover:text-white">
              ← Back
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
              <CircularMatchProgress score={matchScore} threshold={SUCCESS_THRESHOLD} />
              <span className="text-sm text-white/70">Match</span>
              <span className="text-lg font-bold tabular-nums">{matchScore}%</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/70">
              <span className={autoCaptureEnabled ? 'text-white' : 'text-white/40'}>Auto-capture</span>
              <button
                onClick={() => setAutoCaptureEnabled((v) => !v)}
                className={`w-14 h-6 rounded-full border border-white/20 relative transition-colors ${
                  autoCaptureEnabled ? 'bg-green-600' : 'bg-white/10'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    autoCaptureEnabled ? 'translate-x-7' : 'translate-x-0.5'
                  }`}
                />
                <span
                  className={`absolute inset-y-0 ${autoCaptureEnabled ? 'left-2 text-white/80' : 'right-2 text-white/50'} text-[10px] flex items-center`}
                >
                  {autoCaptureEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
              <span title="Automatically captures photo when you hold 80%+ match for 3 seconds" className="text-white/50 cursor-help">ℹ️</span>
            </div>
          </header>

          <main className="flex-1 relative flex items-center justify-center overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Guidance prompt */}
            {guidancePrompt && !showSuccessModal && (
              <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
                <span className="px-4 py-2 rounded-lg bg-black/70 text-white text-lg font-medium">
                  {guidancePrompt}
                </span>
              </div>
            )}

            {/* Countdown overlay */}
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-7xl font-black text-white drop-shadow-lg">
                  {countdown}
                </span>
              </div>
            )}

            {/* Manual capture */}
            {!showSuccessModal && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <button
                  onClick={() => performCapture('manual')}
                  className="px-6 py-3 rounded-full bg-white text-black font-semibold shadow-lg"
                >
                  📷 Capture
                </button>
              </div>
            )}

            {/* Camera error */}
            {camError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-sm">
                {camError}
              </div>
            )}

            {/* Success modal with captured photo */}
            {showSuccessModal && capturedPhoto && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                <div className="bg-zinc-900 border border-white/15 rounded-2xl p-5 max-w-sm w-full flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                    <span className="text-2xl">&#10003;</span>
                  </div>
                  <h2 className="text-xl font-bold text-white">Nailed it!</h2>
                  <img
                    src={capturedPhoto}
                    alt="Captured pose"
                    className="w-full rounded-xl aspect-[3/4] object-cover"
                  />
                  <p className="text-sm text-white/60">
                    {matchScore}% match &middot; {currentPoseName} &middot; {lastCaptureType ?? 'manual'}
                  </p>
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={handleSaveConfirmed}
                      disabled={saveInFlight}
                      className="flex-1 py-2.5 rounded-xl bg-white text-black text-center text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-60"
                    >
                      {saveInFlight ? 'Saving…' : 'Save to Gallery'}
                    </button>
                    <button
                      onClick={handleResetCapture}
                      className="flex-1 py-2.5 rounded-xl bg-white/10 border border-white/15 text-center text-sm font-medium hover:bg-white/15 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
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
