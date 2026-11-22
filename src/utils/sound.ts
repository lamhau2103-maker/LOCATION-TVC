/**
 * BỘ TỔNG HỢP ÂM THANH SCI-FI (WEB AUDIO API)
 * Không sử dụng file âm thanh bên ngoài, tạo trực tiếp sóng âm thanh sạch và mượt:
 * - playWhoosh: Tiếng lướt không gian khi camera bay (flyTo)
 * - playPing: Tiếng radar sonar khi bấm vào trang trại
 * - playScanSuccess: Tiếng báo hiệu khi nạp dữ liệu thành công
 */

class SoundEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Tiếng "ping" sonar trong trẻo khi chọn Marker trang trại
   */
  public playPing(enabled: boolean) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Âm chính (Sonar High Ping)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.5, now); // C6
    osc1.frequency.exponentialRampToValueAtTime(1318.5, now + 0.09); // E6

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(0.14, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.0008, now + 0.65);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.68);

    // Âm vọng phụ (Sub-harmonic echo)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(523.25, now + 0.05);

    gain2.gain.setValueAtTime(0.001, now + 0.05);
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0008, now + 0.55);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.58);
  }

  /**
   * Tiếng "whoosh" không gian nhẹ nhàng khi camera bay (flyTo)
   */
  public playWhoosh(enabled: boolean, durationSec = 1.6) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    // Bộ lọc thông dải quét tần số tạo cảm giác bay qua khí quyển
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(2.8, now);
    filter.frequency.setValueAtTime(160, now);
    filter.frequency.exponentialRampToValueAtTime(
      720,
      now + durationSec * 0.45
    );
    filter.frequency.exponentialRampToValueAtTime(110, now + durationSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + durationSec * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

    // Kết hợp âm trầm ấm
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(65, now);
    subOsc.frequency.exponentialRampToValueAtTime(
      140,
      now + durationSec * 0.4
    );
    subOsc.frequency.exponentialRampToValueAtTime(55, now + durationSec);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.08, now + durationSec * 0.3);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);

    whiteNoise.start(now);
    whiteNoise.stop(now + durationSec);
    subOsc.start(now);
    subOsc.stop(now + durationSec);
  }

  /**
   * Tiếng chime xác nhận khi nạp dữ liệu KML/CSV thành công
   */
  public playScanSuccess(enabled: boolean) {
    if (!enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const notes = [587.33, 880, 1174.66]; // D5 -> A5 -> D6
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    });
  }
}

export const soundEngine = new SoundEngine();
