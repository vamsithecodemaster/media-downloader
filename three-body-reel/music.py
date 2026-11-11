# Original ambient space pad for the three-body reel (20 s, 48 kHz stereo). No samples, pure synthesis.
import numpy as np, wave, sys

SR, DUR = 48000, 20.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

def smooth(x0, x1, v):
    u = np.clip((v - x0) / (x1 - x0), 0, 1)
    return u * u * (3 - 2 * u)

def pad_note(freq, gain, lfo_rate, lfo_phase, env):
    """Warm detuned pad voice: a few soft harmonics, three detuned copies per channel."""
    out = np.zeros((2, N))
    for ch, spread in ((0, -1), (1, 1)):
        for det in (-0.0045, 0.0, 0.0052):
            f = freq * (1 + det + spread * 0.0012)
            ph = rng.uniform(0, 2 * np.pi)
            v = np.zeros(N)
            for h, a in ((1, 1.0), (2, 0.42), (3, 0.2), (4, 0.09), (5, 0.04)):
                if f * h < 3000:
                    v += a * np.sin(2 * np.pi * f * h * t + ph * h)
            out[ch] += v
    lfo = 0.72 + 0.28 * np.sin(2 * np.pi * lfo_rate * t + lfo_phase)
    return out * gain * lfo * env

# two slow chords: D minor (add9) drifting to B-flat major 7 — open, weightless, a little uneasy
A = smooth(0.0, 3.0, t) * (1 - smooth(9.0, 12.5, t))
B = smooth(9.0, 12.5, t) * (1 - smooth(17.5, 20.0, t))
chordA = [(73.42, 0.4), (110.0, 0.55), (146.83, 0.8), (220.0, 0.8), (293.66, 0.7), (329.63, 0.55), (440.0, 0.4)]
chordB = [(58.27, 0.4), (116.54, 0.55), (174.61, 0.8), (233.08, 0.8), (293.66, 0.7), (349.23, 0.55), (440.0, 0.4)]
mix = np.zeros((2, N))
for i, (f, g) in enumerate(chordA):
    mix += pad_note(f, g, 0.07 + 0.023 * i, i * 1.3, A)
for i, (f, g) in enumerate(chordB):
    mix += pad_note(f, g, 0.06 + 0.027 * i, i * 1.7 + 0.5, B)
mix *= 0.11

# sub bass under each chord
sub = (np.sin(2 * np.pi * 36.71 * t) * A + np.sin(2 * np.pi * 29.14 * t) * B) * 0.045
mix += sub

# sparse glassy bells, like distant stars; pitches from D minor pentatonic
bells = np.zeros((2, N))
notes = [587.33, 880.0, 698.46, 1046.5, 1174.66, 880.0, 1318.5, 698.46, 932.33, 1174.66, 587.33]
times = [1.6, 3.4, 5.1, 6.6, 8.3, 10.2, 11.9, 13.5, 15.0, 16.4, 17.6]
for f, t0 in zip(notes, times):
    n0 = int(t0 * SR); tt = t[: N - n0]
    env = np.exp(-tt / 1.1) * (1 - np.exp(-tt / 0.004))
    v = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.01 * tt) * np.exp(-tt / 0.5)
         + 0.15 * np.sin(2 * np.pi * f * 3.02 * tt) * np.exp(-tt / 0.25)) * env
    pan = rng.uniform(0.2, 0.8)
    bells[0, n0:] += v * np.cos(pan * np.pi / 2); bells[1, n0:] += v * np.sin(pan * np.pi / 2)
bells *= 0.085

# airy noise bed, band-limited in the frequency domain, breathing slowly
noise = rng.standard_normal((2, N))
F = np.fft.rfftfreq(N, 1 / SR)
band = np.exp(-((np.log(np.maximum(F, 1)) - np.log(1800)) ** 2) / (2 * 0.6 ** 2))
air = np.fft.irfft(np.fft.rfft(noise, axis=1) * band, n=N, axis=1)
air = air / np.max(np.abs(air)) * 0.02 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.05 * t - 1.2))

# long hall reverb by convolving with a decaying-noise impulse response
dry = mix + bells + air
L = int(3.5 * SR); ti = np.arange(L) / SR
ir = rng.standard_normal((2, L)) * np.exp(-ti / 0.9) * smooth(0, 0.02, ti)
irF = np.fft.rfftfreq(L, 1 / SR)
ir = np.fft.irfft(np.fft.rfft(ir, axis=1) * (1 / (1 + (irF / 4500) ** 2)), n=L, axis=1)
ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
M = N + L
wet = np.fft.irfft(np.fft.rfft(dry + 2.2 * bells, n=M, axis=1) * np.fft.rfft(ir, n=M, axis=1), n=M, axis=1)[:, :N]
out = 0.62 * dry + 0.5 * wet

# master: fades that match the video's fade-in/out, gentle limiter, normalise
out *= smooth(0, 1.6, t) * (1 - smooth(DUR - 2.4, DUR - 0.05, t))
out = np.tanh(out / np.max(np.abs(out)) * 1.4) / np.tanh(1.4)
out *= 0.84
pcm = (out.T * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('peak', float(np.max(np.abs(out))), 'rms', float(np.sqrt(np.mean(out ** 2))))
