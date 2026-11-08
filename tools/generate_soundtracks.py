#!/usr/bin/env python3
"""Generate original, full-length instrumental game soundtracks for Projeto Tabuada.

Each composition is a real stereo MP3 file (not a short WebAudio beep loop).
The 36-bar arrangements are over 60 seconds and have intro, A, B, variation,
bridge and outro sections. All sounds are synthesized from original note events.
"""
from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 22050
BARS = 36
BEATS_PER_BAR = 4

# slug, title, style, bpm, tonic MIDI, scale, chord progression, lead patch,
# groove, melody degrees (None = rest), energy
TRACKS = [
    ("pixel-adventure", "Pixel Adventure", "Chiptune de aventura", 126, 60, "major", [0, 4, 5, 3], "square", "arcade", [7,None,9,11,None,9,7,None,5,None,7,9,7,None,5,None], 1.00),
    ("racing-neon", "Racing Neon", "Corrida eletrônica", 132, 55, "mixolydian", [0, 4, 5, 3], "saw", "dance", [7,9,11,None,12,11,9,None,7,9,11,12,None,11,9,7], 1.08),
    ("rpg-kingdom", "Kingdom of Heroes", "RPG cinematográfico", 112, 57, "minor", [0, 5, 3, 6], "strings", "cinematic", [7,None,10,12,None,10,7,None,5,7,None,10,8,None,7,None], .90),
    ("arcade-bounce", "Arcade Bounce", "Funk de arcade", 124, 65, "dorian", [0, 3, 4, 0], "square", "funk", [7,None,9,11,9,None,7,4,5,None,7,9,11,None,9,7], 1.04),
    ("dungeon-boss", "Dungeon Boss", "Batalha de chefão", 128, 53, "phrygian", [0, 1, 5, 4], "saw", "battle", [0,None,3,5,7,5,3,None,10,None,8,7,5,None,3,2], 1.10),
    ("sky-islands", "Sky Islands", "Exploração e fantasia", 116, 60, "major", [0, 5, 3, 4], "flute", "adventure", [12,None,9,7,12,None,9,7,11,9,7,None,9,7,5,None], .90),
    ("speedrun", "Speedrun!", "Arcade acelerado", 132, 57, "minor", [0, 3, 5, 4], "square", "dance", [7,10,12,None,10,7,5,None,7,10,12,14,None,12,10,7], 1.12),
    ("puzzle-funk", "Puzzle Funk", "Puzzle e groove", 120, 69, "major", [0, 5, 3, 4], "keys", "funk", [9,None,7,5,None,7,9,None,12,11,9,None,7,5,7,None], .95),
    ("retro-platform", "Retro Platform", "Plataforma retrô", 122, 62, "major", [0, 4, 5, 3], "square", "arcade", [0,4,7,None,9,7,4,None,7,9,12,None,11,9,7,4], 1.00),
    ("cyber-arena", "Cyber Arena", "Eletrônica futurista", 130, 60, "minor", [0, 6, 3, 4], "saw", "electro", [0,None,7,10,12,None,10,7,5,None,7,12,10,None,7,5], 1.08),
    ("forest-quest", "Forest Quest", "Aventura na floresta", 114, 57, "dorian", [0, 3, 4, 0], "flute", "adventure", [7,None,9,10,None,9,7,None,5,None,7,9,10,None,9,7], .88),
    ("pixel-rock", "Pixel Rock", "Rock de videogame", 128, 59, "minor", [0, 5, 3, 6], "guitar", "rock", [0,3,5,None,7,5,3,None,10,8,7,None,5,3,2,None], 1.08),
    ("star-runner", "Star Runner", "Corrida espacial", 126, 62, "lydian", [0, 4, 2, 5], "saw", "electro", [12,None,11,9,7,None,9,11,12,None,14,12,11,None,9,7], 1.02),
    ("victory-lap", "Victory Lap", "Pop de vitória", 124, 60, "major", [0, 3, 4, 5], "keys", "dance", [0,4,7,None,9,7,4,None,7,9,12,None,14,12,11,9], 1.04),
    ("stealth-mission", "Stealth Mission", "Missão secreta", 112, 57, "minor", [0, 3, 5, 4], "pluck", "stealth", [7,None,None,5,3,None,5,None,7,None,10,9,7,None,5,None], .84),
    ("ocean-world", "Ocean World", "Exploração subaquática", 110, 64, "major", [0, 4, 3, 5], "bell", "ambient", [12,None,9,7,None,9,11,None,12,11,9,None,7,5,7,None], .82),
    ("desert-rally", "Desert Rally", "Rally e aventura", 130, 55, "mixolydian", [0, 4, 5, 3], "guitar", "rock", [7,9,10,None,12,10,9,None,7,10,12,None,10,9,7,5], 1.08),
    ("magic-castle", "Magic Castle", "Fantasia medieval", 118, 60, "major", [0, 3, 4, 0], "strings", "cinematic", [12,None,11,9,7,None,9,11,12,None,9,7,5,None,7,None], .92),
    ("neon-drift", "Neon Drift", "Synthwave gamer", 120, 57, "minor", [0, 6, 3, 7], "saw", "synthwave", [7,None,10,12,None,10,7,5,7,None,10,12,14,None,12,10], 1.00),
    ("final-boss", "Final Boss", "Épico de ação", 126, 53, "minor", [0, 5, 3, 6], "brass", "battle", [0,3,5,None,7,10,8,None,12,10,8,None,7,5,3,0], 1.12),
]

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}

def degree_midi(root: int, scale: list[int], degree: int, octave: int = 0) -> int:
    return root + scale[degree % 7] + 12 * (degree // 7 + octave)

def pan_gains(pan: float) -> tuple[float, float]:
    angle = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4
    return math.cos(angle), math.sin(angle)

def add_voice(mix: np.ndarray, start: float, midi: int, duration: float,
              patch: str, volume: float, pan: float = 0.0,
              seed: int = 0) -> None:
    start_i = max(0, int(start * SAMPLE_RATE))
    if start_i >= len(mix) or duration <= 0:
        return
    n = min(int(duration * SAMPLE_RATE), len(mix) - start_i)
    if n < 8:
        return
    t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
    freq = 440.0 * (2.0 ** ((midi - 69) / 12.0))
    phase = 2 * np.pi * freq * t
    vib = np.sin(2 * np.pi * 4.7 * t) * (0.0025 if patch in ("strings", "brass") else 0.0007)
    p = phase * (1.0 + vib)
    if patch == "square":
        tone = (np.sin(p) + .30*np.sin(3*p) + .14*np.sin(5*p) + .08*np.sin(7*p)) / 1.52
    elif patch in ("saw", "guitar"):
        tone = (np.sin(p) + .48*np.sin(2*p) + .30*np.sin(3*p) + .18*np.sin(4*p) + .10*np.sin(5*p)) / 2.06
        if patch == "guitar":
            tone = (tone + .28*np.sin(p*2.01)) / 1.28
    elif patch == "keys":
        tone = (np.sin(p) + .36*np.sin(2*p) + .16*np.sin(3*p) + .08*np.sin(4*p)) / 1.60
    elif patch == "bell":
        tone = .78*np.sin(p) + .30*np.sin(2.76*p) + .16*np.sin(4.9*p)
        tone /= 1.24
    elif patch == "flute":
        tone = .82*np.sin(p) + .15*np.sin(2*p) + .04*np.sin(3*p)
    elif patch == "brass":
        tone = .70*np.sin(p) + .27*np.sin(2*p) + .13*np.sin(3*p) + .07*np.sin(4*p)
    elif patch == "strings":
        tone = .65*np.sin(p) + .23*np.sin(p*1.006) + .12*np.sin(p*.994) + .08*np.sin(2*p)
        tone /= 1.08
    elif patch == "pluck":
        tone = .80*np.sin(p) + .20*np.sin(2*p) + .10*np.sin(3*p)
    else:
        tone = np.sin(p)

    attack = min(.18, max(.008, duration * (.20 if patch in ("strings", "flute") else .035)))
    release = min(.28, max(.04, duration * .24))
    env = np.ones(n, dtype=np.float32)
    a = max(1, int(attack*SAMPLE_RATE))
    env[:a] = np.linspace(.001, 1.0, min(a, n), dtype=np.float32)
    if patch in ("keys", "bell", "pluck", "guitar"):
        decay = np.exp(-t * (2.7 if patch == "keys" else 3.8))
        env *= (.22 + .78*decay)
    elif patch in ("square", "saw", "brass"):
        env *= .88 + .12*np.sin(2*np.pi*3.2*t)
    if n > int(release*SAMPLE_RATE):
        r = max(1, int(release*SAMPLE_RATE))
        env[-r:] *= np.linspace(1.0, .001, r, dtype=np.float32)
    if patch in ("bell", "flute"):
        env *= np.exp(-t * (1.5 if patch == "bell" else .25))
    left, right = pan_gains(pan)
    voice = tone.astype(np.float32) * env * volume
    mix[start_i:start_i+n, 0] += voice * left
    mix[start_i:start_i+n, 1] += voice * right

def add_kick(mix: np.ndarray, start: float, power: float) -> None:
    i = int(start*SAMPLE_RATE); n = min(int(.22*SAMPLE_RATE), len(mix)-i)
    if n <= 0: return
    t = np.arange(n, dtype=np.float32)/SAMPLE_RATE
    phase = 2*np.pi*(92*t - 40*t*t)
    env = np.exp(-t*22)
    x = np.sin(phase)*env*(.22*power)
    mix[i:i+n,0] += x*.707; mix[i:i+n,1] += x*.707

def add_noise_hit(mix: np.ndarray, start: float, duration: float,
                  volume: float, kind: str, rng: np.random.Generator) -> None:
    i = int(start*SAMPLE_RATE); n = min(int(duration*SAMPLE_RATE), len(mix)-i)
    if n <= 0: return
    noise = rng.normal(0, 1, n).astype(np.float32)
    if kind == "hat":
        noise = np.concatenate(([noise[0]], np.diff(noise))).astype(np.float32)
        env = np.exp(-np.arange(n, dtype=np.float32)/SAMPLE_RATE*55)
    else:
        # A short, filtered-noise snare with a tiny tonal body.
        env = np.exp(-np.arange(n, dtype=np.float32)/SAMPLE_RATE*18)
        noise = noise*.72 + .28*np.sin(2*np.pi*190*np.arange(n,dtype=np.float32)/SAMPLE_RATE)
    hit = noise*env*volume
    mix[i:i+n,0] += hit*.707
    mix[i:i+n,1] += hit*.707

def groove_events(mix, beat_time, beat_in_bar, groove, energy, rng):
    # Four-on-the-floor, rock, arcade, funk and cinematic game drums.
    kick_beats = {
        "dance": {0,1,2,3}, "electro": {0,2}, "synthwave": {0,2},
        "funk": {0,2,3}, "rock": {0,2}, "battle": {0,2,3},
        "arcade": {0,2}, "adventure": {0}, "cinematic": {0,2},
        "stealth": {0}, "ambient": {0},
    }
    if beat_in_bar in kick_beats.get(groove, {0,2}):
        add_kick(mix, beat_time, energy*(.8 if groove in ("adventure","ambient","stealth") else 1))
    if beat_in_bar in ({1,3} if groove in ("dance","electro","synthwave") else {1,3}):
        snare_volume = .065 if groove in ("ambient","stealth","adventure") else .105
        add_noise_hit(mix, beat_time, .15, snare_volume*energy, "snare", rng)
    # Eighth-note hi-hats make the beat feel like a song rather than isolated notes.
    if groove not in ("cinematic", "ambient") or beat_in_bar in (1,3):
        hat_time = beat_time
        add_noise_hit(mix, hat_time, .045, (.022 if groove in ("ambient","stealth") else .034)*energy, "hat", rng)
        add_noise_hit(mix, hat_time + 30/60, .032, .014*energy, "hat", rng)

def make_track(track, output_dir: Path) -> dict:
    slug, title, style, bpm, root, scale_name, progression, lead, groove, motif, energy = track
    scale = SCALES[scale_name]
    beat = 60.0 / bpm
    bar_duration = beat * BEATS_PER_BAR
    duration = BARS * bar_duration + 1.4
    samples = int(math.ceil(duration*SAMPLE_RATE))
    mix = np.zeros((samples, 2), dtype=np.float32)
    rng = np.random.default_rng(sum(ord(c) for c in slug) * 29)
    chord_patch = "strings" if groove == "cinematic" else ("keys" if groove in ("funk","dance") else "saw")
    bass_patch = "saw" if groove in ("dance","electro","synthwave","battle","rock") else "keys"
    arp_patch = "bell" if groove in ("adventure","cinematic","ambient") else ("square" if lead == "square" else "pluck")

    for bar in range(BARS):
        bar_start = bar*bar_duration
        section = 0 if bar < 4 else 1 if bar < 12 else 2 if bar < 20 else 3 if bar < 28 else 4 if bar < 32 else 5
        chord_degree = progression[(bar//2) % len(progression)]
        section_gain = [0.48, 1.0, .94, 1.05, .72, .92][section]
        if section == 4:
            section_gain *= .76
        # Chords: a sustained bed with a different attack pattern for each style.
        chord_notes = [degree_midi(root,scale,chord_degree,0),
                       degree_midi(root,scale,chord_degree+2,0),
                       degree_midi(root,scale,chord_degree+4,0)]
        for j, note in enumerate(chord_notes):
            chord_start = bar_start + (0.0 if j == 0 else .018*j)
            add_voice(mix, chord_start, note, bar_duration*.93,
                      chord_patch, .030*energy*section_gain*(1 if j == 0 else .78),
                      (-.45, .38, .04)[j])
        # Moving chord keys / offbeat stabs.
        if groove in ("funk","dance","electro","synthwave","arcade","rock"):
            for beat_i in (1,3):
                for j,note in enumerate(chord_notes):
                    add_voice(mix, bar_start+beat_i*beat, note+12, beat*.33,
                              "keys" if groove in ("funk","dance") else "square",
                              .033*energy*section_gain, (-.35,.35,0)[j])
        # Bass line, with a small syncopation change by section.
        bass_degree = chord_degree
        for beat_i in range(4):
            if groove in ("dance","electro","synthwave"):
                starts = [0,1,2,3]
            elif groove in ("funk","battle","rock"):
                starts = [0,2] if beat_i in (0,2) else ([3] if groove == "funk" and beat_i == 3 else [])
            else:
                starts = [beat_i] if beat_i in (0,2) else []
            if starts:
                note = degree_midi(root,scale,bass_degree, -2)
                add_voice(mix, bar_start+beat_i*beat, note, beat*.78,
                          bass_patch, .075*energy*section_gain, 0)
        # Eighth-note melody, transformed between sections so the arrangement develops.
        for step, degree in enumerate(motif):
            if degree is None: continue
            if section == 0 and step not in (0,4): continue
            if section == 4 and step % 2: continue
            transformed = degree
            if section == 2 and step in (2,6,10,14):
                transformed += 2
            elif section == 3 and step in (4,12):
                transformed += 7
            elif section == 5 and step in (0,8):
                transformed += 7
            start = bar_start + step*(beat/2)
            octave = 1 if lead not in ("flute","strings","brass") else 0
            add_voice(mix,start,degree_midi(root,scale,transformed,octave),
                      beat*.44,lead,.060*energy*section_gain,
                      (-.16 if step%4<2 else .16))
        # Arpeggiated movement in game-inspired electronic / fantasy themes.
        if groove in ("adventure","cinematic","ambient","arcade","electro","synthwave"):
            arp = [chord_degree+4, chord_degree+2, chord_degree, chord_degree+2,
                   chord_degree+4, chord_degree+6, chord_degree+4, chord_degree+2]
            for step, degree in enumerate(arp):
                if section == 0 and step > 3: continue
                if section == 4 and step%2: continue
                add_voice(mix,bar_start+step*(beat/2),degree_midi(root,scale,degree,1),
                          beat*.30,arp_patch,.025*energy*section_gain,
                          -.32 if step%2==0 else .32)
        # Percussion layers and a fill near section changes.
        for beat_i in range(4):
            if section == 0 and bar < 2 and beat_i not in (0,2): continue
            groove_events(mix,bar_start+beat_i*beat,beat_i,groove,energy*section_gain,rng)
        if bar in (11,19,27,31):
            for offset in (3.0,3.5):
                add_noise_hit(mix,bar_start+offset*beat,.12,.09*energy,"snare",rng)

    # Short fade-in/out, soft saturation and normalization.
    fade = int(1.1*SAMPLE_RATE)
    mix[:fade] *= np.linspace(0,1,fade,dtype=np.float32)[:,None]
    mix[-fade:] *= np.linspace(1,0,fade,dtype=np.float32)[:,None]
    mix = np.tanh(mix*1.6)
    peak = float(np.max(np.abs(mix))) or 1.0
    mix *= (0.88/peak)
    pcm = np.int16(np.clip(mix,-1,1)*32767)

    output_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav",delete=False) as temp:
        wav_path = Path(temp.name)
    try:
        with wave.open(str(wav_path),"wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm.tobytes())
        mp3_path = output_dir / f"{slug}.mp3"
        subprocess.run([
            "ffmpeg","-hide_banner","-loglevel","error","-y",
            "-i",str(wav_path),"-codec:a","libmp3lame","-b:a","112k",
            "-ar",str(SAMPLE_RATE),"-ac","2",str(mp3_path)
        ],check=True)
    finally:
        wav_path.unlink(missing_ok=True)
    return {
        "id": slug, "name": title, "genre": style,
        "src": f"assets/music/{slug}.mp3",
        "duration_seconds": round(duration,2),
        "bpm": bpm, "file_bytes": mp3_path.stat().st_size,
        "license": "Original synthesized soundtrack generated for Projeto Tabuada."
    }

def main():
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required to encode the soundtrack files.")
    output_dir = Path("assets/music")
    manifest = []
    for index, track in enumerate(TRACKS,1):
        print(f"[{index:02d}/{len(TRACKS)}] Rendering {track[1]}...")
        manifest.append(make_track(track,output_dir))
    (output_dir/"manifest.json").write_text(
        json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )
    total_bytes = sum(item["file_bytes"] for item in manifest)
    print(f"Generated {len(manifest)} original tracks; total MP3 size: {total_bytes/1024/1024:.1f} MiB")
    for item in manifest:
        print(f"{item['name']}: {item['duration_seconds']}s ({item['file_bytes']} bytes)")

if __name__ == "__main__":
    main()
