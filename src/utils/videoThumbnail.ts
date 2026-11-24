export interface VideoMetadataResult {
  duration: number;
  width: number;
  height: number;
  thumbnailUrl: string | null;
}

export interface ImageMetadataResult {
  width: number;
  height: number;
  thumbnailUrl: string;
}

export function extractVideoMetadata(objectUrl: string): Promise<VideoMetadataResult> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let settled = false;
    const finish = (
      duration: number,
      width: number,
      height: number,
      thumbnailUrl: string | null
    ) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve({duration, width, height, thumbnailUrl});
    };

    const timeoutId = window.setTimeout(() => {
      finish(
        Number.isFinite(video.duration) ? video.duration : 0,
        video.videoWidth || 1280,
        video.videoHeight || 720,
        null
      );
    }, 4000);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const targetTime = duration > 0.5 ? Math.min(0.5, duration * 0.15) : 0;
      try {
        video.currentTime = targetTime;
      } catch {
        window.clearTimeout(timeoutId);
        finish(
          duration,
          video.videoWidth || 1280,
          video.videoHeight || 720,
          null
        );
      }
    };

    video.onseeked = () => {
      window.clearTimeout(timeoutId);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      try {
        const maxThumbWidth = 320;
        const scale = Math.min(1, maxThumbWidth / vw);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vw * scale));
        canvas.height = Math.max(1, Math.round(vh * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          finish(duration, vw, vh, dataUrl);
          return;
        }
      } catch {
        // Fallback cleanly if canvas extraction fails
      }
      finish(duration, vw, vh, null);
    };

    video.onerror = () => {
      window.clearTimeout(timeoutId);
      finish(0, 1280, 720, null);
    };

    video.src = objectUrl;
  });
}

export function extractImageMetadata(objectUrl: string): Promise<ImageMetadataResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 800;
      const h = img.naturalHeight || 800;
      resolve({width: w, height: h, thumbnailUrl: objectUrl});
    };
    img.onerror = () => {
      resolve({width: 800, height: 800, thumbnailUrl: objectUrl});
    };
    img.src = objectUrl;
  });
}
