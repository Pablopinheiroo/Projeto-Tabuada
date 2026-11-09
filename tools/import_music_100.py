from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
MUSIC_DIR = ROOT / "assets" / "music"
MANIFEST_PATH = MUSIC_DIR / "manifest.json"
TARGET_PER_CATEGORY = 20
MIN_SECONDS = 30
AUDIO_EXTENSIONS = {".mp3", ".ogg", ".wav", ".flac", ".m4a"}
VARIANT_RE = re.compile(r"(^|[ _.-])(alt|alternate|variation|var|climax|remix|demo|preview|stems?|version[ _.-]*2|v2)([ _.-]|$)", re.I)

CATEGORIES = {
    "principal": {
        "title": "Tela principal",
        "style": "Menu leve, divertido e com clima de videogame.",
    },
    "treinamento": {
        "title": "Treinamento",
        "style": "Trilhas tranquilas para manter a concentração.",
    },
    "desafio": {
        "title": "Desafio",
        "style": "Trilhas rápidas, agitadas e emocionantes para partidas cronometradas.",
    },
    "modo-jogo": {
        "title": "Modo Jogo",
        "style": "Aventura, fantasia e exploração.",
    },
    "torneio": {
        "title": "Torneio",
        "style": "Competição intensa, tensão e clima de batalha.",
    },
}

# Arquivos individuais. Todas as páginas abaixo identificam a licença CC0.
SINGLES = {
    "principal": [
        ("hella-bumps", "Hella Bumps", "Menu / House animado", "hella bumps.mp3", "cynicmusic", "https://opengameart.org/content/hella-bumps-menu-music"),
        ("menu-running-title", "Menu em Movimento", "Menu / Retrô", "New age.mp3", "R0B B3RY", "https://opengameart.org/content/menu-running-title"),
        ("menu-sinking", "Menu Sinking", "Menu / Eletrônica", "Sinking.mp3", "carlofcool", "https://opengameart.org/content/menu-sound"),
        ("menu-theme-8bit", "Menu em 8 Bits", "Menu / Chiptune", "menu_title.mp3", "tamesu", "https://opengameart.org/content/menu-theme"),
        ("main-menu-space", "Menu Espacial", "Menu / Ambiente", "janmainmenu.MP3", "kerker97", "https://opengameart.org/content/main-menu-music"),
        ("overworld-menu", "Menu de Exploração", "Menu / Eletrônica", "_overworldmenu.wav", "Umplix", "https://opengameart.org/content/overworldmenu"),
        ("shine-blitz", "Brilho e Energia", "Menu / Alegre", "shineblitz.ogg", "zesona", "https://opengameart.org/content/shine-blitz"),
        ("songs-wealthy", "Wealthy", "Menu / Eletrônica", "wealthy3.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-woke", "Woke", "Menu / Eletrônica", "woke2.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-billion", "Billion", "Menu / Eletrônica", "billion.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-farm", "Farm", "Menu / Eletrônica", "farm.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-trailer", "Trailer", "Menu / Cinemática", "trailer.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-rush", "Rush", "Menu / Eletrônica", "rush.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-sakuriasis", "Sakuriasis", "Menu / Eletrônica", "sakuriasis.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-vox", "Vox", "Menu / Eletrônica", "vox.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-beatnik", "Beatnik", "Menu / Eletrônica", "beatnik.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-moments", "Moments", "Menu / Eletrônica", "moments.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-too", "Too", "Menu / Eletrônica", "too.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-fakie", "Fakie Dakie", "Menu / Eletrônica", "fakie_dakie.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
        ("songs-hard", "Hard", "Menu / Eletrônica", "hard.mp3", "awdawdawdwda", "https://opengameart.org/content/songs-0"),
    ],
    "treinamento": [
        ("calm-track", "Calma e Concentração", "Calma / Ambiente", "calm_track-loop.ogg", "pmiller", "https://opengameart.org/content/calm-track"),
        ("relax-tune", "Melodia Tranquila", "Calma / RPG", "relaxtune1.ogg", "Tozan", "https://opengameart.org/content/bgm-music"),
        ("calm-theme", "Tema Tranquilo", "Calma / Exploração", "calm_theme.ogg", "pebonius", "https://opengameart.org/content/calm-music-0"),
        ("ambient-track", "Ambiente Aconchegante", "Calma / Lo-fi", "ambienttrack.ogg", "annandistance", "https://opengameart.org/content/feel-good-slow-ambient-track-with-a-beat"),
        ("first-light", "Primeira Luz", "Calma / Piano", "first_light_particles.wav", "Yoiyami", "https://opengameart.org/content/first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track"),
        ("deep-blue-theme", "Tema Azul Profundo", "Calma / Piano", "yoiyami_core_theme.wav", "Yoiyami", "https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano"),
        ("sunset-plains", "Planícies ao Pôr do Sol", "Calma / Natureza", "sunset_plains.wav", "Yoiyami", "https://opengameart.org/content/sunset-plains"),
    ],
    "desafio": [
        ("intense-boss", "Chefe em Alta Tensão", "Desafio / Batalha", "intense_boss_battle.mp3", "haruta", "https://opengameart.org/content/intense-boss-battle"),
        ("hard-boss", "Chefe Implacável", "Desafio / Synth", "hard_boss_battle_1_bpm200.mp3", "MintoDog", "https://opengameart.org/content/hard-boss-battle-1"),
        ("hard-battle-two", "Batalha Eletrônica", "Desafio / Techno", "hard_battle_2_bpm140.mp3", "MintoDog", "https://opengameart.org/content/hard-battle-2"),
        ("fast-fight", "Combate Veloz", "Desafio / Ação", "fight.ogg", "Ville Nousiainen / Xythe / mutkanto", "https://opengameart.org/content/fast-fight-battle-music"),
        ("upbeat-chiptune", "Chiptune Acelerado", "Desafio / Chiptune", "fasttheme.ogg", "nihilocrat", "https://opengameart.org/content/upbeat-chiptune-theme"),
        ("fairy-battles", "Batalha das Fadas", "Desafio / Fantasia", "fairy_battles_bpm180.ogg", "MintoDog", "https://opengameart.org/content/fairy-battles"),
        ("miniboss-eight-bit", "Minichefe em 8 Bits", "Desafio / Chiptune", "8bit_action_miniboss_battle_bpm175.mp3", "MintoDog", "https://opengameart.org/content/8bit-action-miniboss-battle"),
        ("orchestral-battle", "Batalha Orquestral", "Desafio / Orquestral", "Battle.mp3", "Wolfgang_", "https://opengameart.org/content/battle-theme-0"),
        ("midi-battle", "Duelo Retrô", "Desafio / Retrô", "battle.mp3", "tapatilorenzo", "https://opengameart.org/content/midi-battle-theme"),
        ("oh-boss", "Oh, Chefão!", "Desafio / Batalha", "oh_boss.mp3", "haruta", "https://opengameart.org/content/oh-boss"),
        ("prepare-to-fight", "Prepare-se para Lutar", "Desafio / Épico", "prepare_to_fight.mp3", "Basil", "https://opengameart.org/content/prepare-to-fight"),
        ("eight-bit-boss", "Chefe em 8 Bits", "Desafio / Chiptune", "8bit_action_boss_battle_bpm145.mp3", "MintoDog", "https://opengameart.org/content/8bit-action-boss-battle"),
        ("zelda-boss-theme", "Chefe em 8 Bits — Estilo Aventura", "Desafio / Chiptune", "8bit_jrpg_boss_battle.mp3", "HydroGene", "https://opengameart.org/content/zelda-style-8-bit-boss-theme"),
        ("boss-battle-two", "Batalha do Chefão 2", "Desafio / 8 Bits", "boss_battle_#2.WAV", "nene", "https://opengameart.org/content/boss-battle-2-8-bit"),
        ("prepare-your-swords", "Prepare suas Espadas", "Desafio / Fantasia", "prepare_your_swords.ogg", "Bojidar Marinov", "https://opengameart.org/content/prepare-your-swords"),
    ],
    "modo-jogo": [
        ("fairy-adventure", "Aventura das Fadas", "Fantasia / Aventura", "fairy_adventure_bpm140.ogg", "MintoDog", "https://opengameart.org/content/fairy-adventure"),
        ("medieval-exploration", "Exploração Medieval", "Fantasia / RPG", "Exploration.mp3", "RandomMind", "https://opengameart.org/content/medieval-exploration"),
        ("exploring-town", "Passeio pela Vila", "Vila / Chiptune", "Exploring Town.ogg", "Spring Spring", "https://opengameart.org/content/exploring-town"),
        ("magic-puzzle", "Enigma Mágico", "Fantasia / Puzzle", "magic_puzzle_in-game_1_bpm110.mp3", "MintoDog", "https://opengameart.org/content/magic-puzzle-in-game-1"),
    ],
    "torneio": [
        ("boss-rpg-theme", "Tema de Batalha RPG", "Torneio / Orquestral", "CleytonRX - Battle RPG Theme.mp3", "CleytonKauffman", "https://opengameart.org/content/boss-battle-theme"),
        ("urban-boss", "Chefe da Cidade", "Torneio / Brass", "urban_boss_battle_bpm135.mp3", "MintoDog", "https://opengameart.org/content/urban-boss-battle"),
        ("battle-spring", "Batalha Sintética", "Torneio / Retrô", "Battle 1.ogg", "Spring Spring", "https://opengameart.org/content/is-it-a-battle"),
        ("epic-boss-loop", "Chefe Épico", "Torneio / Orquestral", "Juhani Junkala - Epic Boss Battle [Seamlessly Looping].wav", "SubspaceAudio", "https://opengameart.org/content/boss-battle-music"),
        ("danger-strong-boss", "Perigo: Chefão Forte", "Torneio / 8 Bits", "8-bit_danger_strong_boss.mp3", "HydroGene", "https://opengameart.org/content/8-bit-danger-strong-boss"),
    ],
}

# Pacotes gratuitos CC0. O importador escolhe composições individuais do ZIP,
# nunca versões "climax", "alt", "variation" ou remixes.
PACKS = {
    "principal": [
        ("game-loops", "GameLoops.zip", "https://opengameart.org/content/royalty-free-game-music-loops", "Pudgyplatypus", "Pacote de trilhas variadas para jogos"),
    ],
    "treinamento": [
        ("relaxing-instrumentals", "relaxing_instrumentals.zip", "https://opengameart.org/content/relaxing-instrumentals-collection", "Holizna", "Instrumentais relaxantes"),
        ("chill-beats", "chill_beats.zip", "https://opengameart.org/content/chill-beats-collection", "Holizna", "Batidas tranquilas"),
        ("lofi-collection", "lo-fi_and_chill_lofi_collection.zip", "https://opengameart.org/content/lo-fi-and-chill-collection", "Holizna", "Coleção lo-fi e calma"),
    ],
    "desafio": [
        ("jrpg-action", "JRPG Music Pack #5 [Action] by Juhani Junkala.zip", "https://opengameart.org/content/jrpg-pack-5-action", "SubspaceAudio", "Ação para RPG"),
    ],
    "modo-jogo": [
        ("jrpg-exploration", "JRPG Music Pack #1 [Exploration] by Juhani Junkala.zip", "https://opengameart.org/content/jrpg-pack-1-exploration", "SubspaceAudio", "Exploração em RPG"),
        ("jrpg-calm", "JRPG Music Pack #4 [Calm] by Juhani Junkala.zip", "https://opengameart.org/content/jrpg-pack-4-calm", "SubspaceAudio", "RPG calmo e contemplativo"),
        ("gameboy-collection", "game_soundtrack.zip", "https://opengameart.org/content/a-music-collection", "Trinity Paradox", "Coleção de composições Game Boy"),
        ("exploration-theme", "exploration_theme.zip", "https://opengameart.org/content/exploration-theme", "CleytonKauffman", "Exploração atmosférica"),
        ("prologue-theme", "Prologue Theme.zip", "https://opengameart.org/content/prologue-theme", "CleytonKauffman", "Tema de abertura para aventura"),
    ],
    "torneio": [
        ("five-action-chiptunes", "5 Action Chiptunes By Juhani Junkala.zip", "https://opengameart.org/content/5-chiptunes-action", "SubspaceAudio", "Cinco composições de ação em chiptune"),
        ("free-music-pack", "Alexander Ehlers - Free Music Pack.zip", "https://opengameart.org/content/free-music-pack", "Alexander Ehlers", "Músicas orquestrais, rock e experimentais"),
    ],
}

def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()

def duration(path: Path) -> float:
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)]))

def slugify(value: str) -> str:
    value = value.lower().replace("&", " e ")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:58] or "trilha"

def normalized_stem(value: str) -> str:
    value = Path(value).stem.lower()
    value = re.sub(r"\b(loop|seamless|hq|lq|mastered|master|final)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", "", value)

def is_variant(path: Path) -> bool:
    return bool(VARIANT_RE.search(path.stem))

def download(filename: str, target: Path) -> None:
    url = "https://opengameart.org/sites/default/files/" + quote(filename, safe="")
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; ProjetoTabuada/2.0)",
        "Referer": "https://opengameart.org/",
    })
    with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as output:
        first = response.read(1024)
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" in content_type or b"<html" in first.lower():
            raise RuntimeError("a origem devolveu HTML em vez do arquivo")
        output.write(first)
        shutil.copyfileobj(response, output)
    if target.stat().st_size < 30000:
        raise RuntimeError("arquivo pequeno demais para uma trilha completa")

def convert_to_mp3(source: Path, target: Path) -> None:
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-vn", "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        str(target),
    ], check=True)
    if target.stat().st_size < 10000:
        target.unlink(missing_ok=True)
        raise RuntimeError("a conversão gerou um arquivo inválido")

def extract_audio_files(archive: Path, destination: Path) -> list[Path]:
    extracted = []
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            if info.is_dir():
                continue
            relative = Path(info.filename)
            if relative.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            if ".." in relative.parts or relative.is_absolute():
                continue
            target = destination / relative.name
            if target.exists():
                target = destination / (slugify(str(relative.parent)) + "-" + relative.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            extracted.append(target)
    return sorted(extracted, key=lambda item: item.name.lower())

def import_music() -> None:
    old = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    old_playlists = old.get("playlists", {})
    playlists = {category: [] for category in CATEGORIES}
    kept_paths = set()
    seen_hashes = set()
    seen_source_titles = set()
    credits = []

    def register_existing(category: str, track: dict) -> None:
        if track.get("id") == "strange-factory-climax" or is_variant(Path(track.get("name", ""))):
            print("Ignorada variação anterior:", track.get("name"))
            return
        path = ROOT / track.get("src", "")
        if not path.is_file():
            print("Faixa anterior ausente:", track.get("name"))
            return
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            return
        seen_hashes.add(digest)
        track = dict(track)
        track["category"] = category
        playlists[category].append(track)
        kept_paths.add(path.name)
        credits.append(track)

    for category in CATEGORIES:
        for track in old_playlists.get(category, []):
            register_existing(category, track)

    def add_audio(category: str, source: Path, title: str, genre: str, author: str,
                  source_page: str, composition_key: str) -> bool:
        if len(playlists[category]) >= TARGET_PER_CATEGORY:
            return False
        if is_variant(source):
            return False
        if composition_key in seen_source_titles:
            return False
        try:
            seconds = duration(source)
            if seconds < MIN_SECONDS:
                print(f"Ignorada por duração ({seconds:.1f}s): {source.name}")
                return False
            raw_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            if raw_hash in seen_hashes:
                print("Ignorada faixa repetida:", source.name)
                return False
            filename = f"{category}-{len(playlists[category]) + 1:02d}-{slugify(title)}.mp3"
            target = MUSIC_DIR / filename
            convert_to_mp3(source, target)
            final_seconds = duration(target)
            if final_seconds < MIN_SECONDS:
                target.unlink(missing_ok=True)
                return False
            final_hash = hashlib.sha256(target.read_bytes()).hexdigest()
            if final_hash in seen_hashes:
                target.unlink(missing_ok=True)
                return False
            seen_hashes.add(raw_hash)
            seen_hashes.add(final_hash)
            seen_source_titles.add(composition_key)
            item = {
                "id": f"{category}-{len(playlists[category]) + 1:02d}-{slugify(title)}",
                "name": title,
                "genre": genre,
                "src": f"assets/music/{filename}",
                "duration_seconds": round(final_seconds, 2),
                "author": author,
                "license": "CC0 1.0",
                "source": source_page,
                "category": category,
            }
            playlists[category].append(item)
            kept_paths.add(filename)
            credits.append(item)
            print(f"OK [{category}] {title} — {final_seconds:.1f}s")
            return True
        except Exception as error:
            print(f"Falhou [{category}] {source.name}: {error}")
            return False

    with tempfile.TemporaryDirectory(prefix="tabuada-music-") as temporary:
        temp = Path(temporary)

        for category, candidates in SINGLES.items():
            for slug, title, genre, filename, author, page in candidates:
                if len(playlists[category]) >= TARGET_PER_CATEGORY:
                    break
                raw = temp / (slug + Path(filename).suffix.lower())
                try:
                    print("Baixando faixa:", title)
                    download(filename, raw)
                    add_audio(category, raw, title, genre, author, page, page + "|" + normalized_stem(filename))
                except Exception as error:
                    print(f"Faixa indisponível [{category}] {title}: {error}")

        for category, packs in PACKS.items():
            for pack_id, filename, page, author, pack_title in packs:
                if len(playlists[category]) >= TARGET_PER_CATEGORY:
                    break
                archive = temp / (pack_id + ".zip")
                extracted_dir = temp / pack_id
                extracted_dir.mkdir(parents=True, exist_ok=True)
                try:
                    print("Baixando pacote CC0:", pack_title, filename)
                    download(filename, archive)
                    audio_files = extract_audio_files(archive, extracted_dir)
                    print(f"Pacote {pack_id}: {len(audio_files)} arquivos de áudio encontrados")
                    seen_in_pack = set()
                    for index, audio in enumerate(audio_files, start=1):
                        if len(playlists[category]) >= TARGET_PER_CATEGORY:
                            break
                        stem = normalized_stem(audio.name)
                        if not stem or stem in seen_in_pack:
                            continue
                        seen_in_pack.add(stem)
                        if is_variant(audio):
                            continue
                        title = audio.stem.replace("_", " ").replace("-", " ").strip()
                        if not title or title.lower().startswith(("readme", "license", "credits")):
                            continue
                        title = f"{pack_title}: {title.title()}"
                        add_audio(category, audio, title, CATEGORIES[category]["title"], author, page,
                                  page + "|" + pack_id + "|" + stem)
                except Exception as error:
                    print(f"Pacote indisponível [{category}] {pack_title}: {error}")

    counts = {category: len(tracks) for category, tracks in playlists.items()}
    print("Contagem final por área:", json.dumps(counts, ensure_ascii=False))
    if any(count != TARGET_PER_CATEGORY for count in counts.values()):
        raise RuntimeError("A biblioteca não chegou a 20 faixas únicas em cada área. Nada será publicado.")

    all_tracks = [track for category in CATEGORIES for track in playlists[category]]
    if len({track["src"] for track in all_tracks}) != 100 or len({track["id"] for track in all_tracks}) != 100:
        raise RuntimeError("Há caminhos ou IDs repetidos na biblioteca.")

    manifest = {
        "version": 4,
        "title": "Biblioteca de 100 trilhas CC0 distintas do Projeto Tabuada",
        "minimum_tracks_per_category": TARGET_PER_CATEGORY,
        "minimum_total_tracks": 100,
        "minimum_duration_seconds": MIN_SECONDS,
        "categories": [
            {"id": category, "title": CATEGORIES[category]["title"],
             "style": CATEGORIES[category]["style"], "tracks": TARGET_PER_CATEGORY}
            for category in CATEGORIES
        ],
        "playlists": playlists,
    }
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    for audio in MUSIC_DIR.glob("*.mp3"):
        if audio.name not in kept_paths:
            audio.unlink()
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Créditos das trilhas sonoras",
        "",
        "O projeto utiliza 100 composições/faixas individuais sob licença **CC0 1.0**.",
        "Não são geradas variações artificiais: cada entrada aponta para um arquivo de áudio próprio.",
        "",
    ]
    for category, tracks in playlists.items():
        lines.extend([f"## {CATEGORIES[category]['title']} — 20 trilhas", ""])
        for track in tracks:
            lines.append(f"- **{track['name']}** — {track['author']} — [origem]({track['source']}) — CC0 1.0")
        lines.append("")
    (MUSIC_DIR / "CREDITOS.md").write_text("\n".join(lines), encoding="utf-8")
    print("Biblioteca pronta: 100 faixas distintas, 20 em cada área.")

if __name__ == "__main__":
    import_music()
