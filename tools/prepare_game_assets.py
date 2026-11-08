from __future__ import annotations
# Reimportação após atualização concorrente dos arquivos da página.
import argparse, hashlib, json, math, shutil, subprocess, tempfile, urllib.request
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MUSIC_DIR = ROOT / "assets" / "music"
AVATAR_DIR = ROOT / "assets" / "avatars"

# Fontes OpenGameArt com licença CC0. A importação mede a duração real,
# descarta arquivos menores que 30 s e evita arquivos repetidos.
CANDIDATES = [
 ("menu-neon","Menu Neon","Menu / Eletrônica","main_menu_music_mastered.mp3","Pro Sensory","https://opengameart.org/content/main-menu-music-loop"),
 ("menu-electro-loop","Menu Eletrônico","Menu / Eletrônica","menu_loop.wav","Umplix","https://opengameart.org/content/menu-loop-0"),
 ("menu-sledding","Menu Deslizante","Menu / Ritmo","menu.ogg","wipics","https://opengameart.org/content/menu-music-1"),
 ("battle-chiptune","Batalha em 8 Bits","Batalha / Chiptune","battle_music_01-loop.ogg","pmiller","https://opengameart.org/content/chiptune-battle-music"),
 ("slay-the-evil","Derrote o Mal","Ação / Chiptune","8-bit_slay_the_evil.ogg","HydroGene","https://opengameart.org/content/8-bit-slay-the-evil"),
 ("hard-battle","Batalha Intensa","Batalha / Synth","hard_battle_1_bpm170.mp3","MintoDog","https://opengameart.org/content/hard-battle-1"),
 ("hard-dungeon","Masmorra Tecnológica","Masmorra / Eletrônica","hard_dungeon_bpm140.mp3","MintoDog","https://opengameart.org/content/hard-dungeon"),
 ("space-boss","Chefe Espacial","Espaço / Batalha","space_boss_battle_bpm175.mp3","MintoDog","https://opengameart.org/content/space-boss-battle"),
 ("strange-factory","Fábrica Misteriosa","Corrida / Eletrônica","strange_factory_bpm100.mp3","MintoDog","https://opengameart.org/content/strange-factory"),
 ("strange-factory-climax","Última Volta","Corrida / Alta energia","strange_factory_climax_bpm200.mp3","MintoDog","https://opengameart.org/content/strange-factory"),
 ("soundtrack-song","Aventura em Pixel","Aventura / RPG","a song.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("castle-theme","Castelo Antigo","Fantasia / RPG","castle 2.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("boss-theme-regular","Confronto do Chefão","Batalha / RPG","Final or Regular Boss Theme.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("into-depths","Nas Profundezas","Exploração / Masmorra","Into Depths! Keep in mind, it's forced.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("village-evening","Vila ao Entardecer","Vila / Tranquila","sad village with claps 'n shit at the end.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("stooges-story","História do Bobo","Aventura / RPG","Stooge's Story.ogg","Spring Spring","https://opengameart.org/content/a-soundtrack"),
 ("puzzle-loop","Puzzle Misterioso","Quebra-cabeça / Calma","simple_loop.ogg","polosik","https://opengameart.org/content/simple-menubackground-music-loop"),
 ("kind-of-boss","Dança do Chefão","Batalha / Retrô","boss.mp3","G_P","https://opengameart.org/content/kind-of-boss"),
 ("crystal-caves","Cavernas de Cristal","Exploração / Fantasia","crystal_caves.mp3","outer123","https://opengameart.org/content/crystal-caves-0"),
 ("great-labyrinth","Grande Labirinto","RPG / Orquestral","great_labyrinth_bpm160.ogg","MintoDog","https://opengameart.org/node/155823"),
 ("awake-action","Ação Frenética","Ação / Breakbeat","awake10_megaWall.mp3","cynicmusic","https://opengameart.org/content/awake-megawall-10"),
 ("eerie-choir","Coro Misterioso","Suspense / Ambiente","eeriechoir.ogg","TheFrenchDodo","https://opengameart.org/content/retro-tunes"),
 ("icy-adventure","Aventura Gelada","Aventura / Retrô","icyadventure-loopable.ogg","TheFrenchDodo","https://opengameart.org/content/retro-tunes"),
 ("retro-boss-fight","Batalha Retrô","Batalha / Retrô","retrobossfight-loopable.ogg","TheFrenchDodo","https://opengameart.org/content/retro-tunes"),
 ("safety-theme","Pausa Tranquila","Eletrônica / Relaxante","Safety.ogg","Fupi","https://opengameart.org/content/safety-2-versions"),
 ("safety-tribe","Ritmo Tribal","Tribal / Percussão","Safety Tribe.ogg","Fupi","https://opengameart.org/content/safety-2-versions"),
 ("krakatoa","Krakatoa","Tribal / Aventura","Krakatoa.ogg","Kistol","https://opengameart.org/content/krakatoa"),
 ("spooky-loop","Suspense Assustador","Suspense / Retrô","spookloopable.ogg","wipics e StumpyStrust","https://opengameart.org/content/spooky-loop-bomba32-wipicks-vs-stumpystrust"),
]

EMOJIS = [
 ("gamer","Jogador","🎧","#2563eb","#7c3aed"),
 ("raposa","Raposa","🦊","#f97316","#fbbf24"),
 ("coroa","Coroa","👑","#ca8a04","#facc15"),
 ("controle","Controle","🎮","#1d4ed8","#06b6d4"),
 ("panda","Panda","🐼","#475569","#cbd5e1"),
 ("pixel","Píxel","👾","#15803d","#86efac"),
 ("leao","Leão","🦁","#b45309","#f59e0b"),
 ("lobo","Lobo","🐺","#475569","#94a3b8"),
 ("pinguim","Pinguim","🐧","#0f766e","#67e8f9"),
 ("unicornio","Unicórnio","🦄","#7e22ce","#f0abfc"),
]

def run(cmd):
 return subprocess.check_output(cmd,text=True).strip()

def duration(path):
 return float(run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(path)]))

def download(filename,target):
 url="https://opengameart.org/sites/default/files/"+quote(filename,safe="")
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; ProjetoTabuada/1.0)","Referer":"https://opengameart.org/"})
 with urllib.request.urlopen(req,timeout=150) as response,target.open("wb") as out:
  first=response.read(1024)
  if "text/html" in response.headers.get("Content-Type","").lower() or b"<html" in first.lower():
   raise RuntimeError("o site devolveu HTML em vez de áudio")
  out.write(first)
  shutil.copyfileobj(response,out)
 if target.stat().st_size<40000: raise RuntimeError("arquivo pequeno demais para uma música completa")

def import_music():
 MUSIC_DIR.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as td:
  td=Path(td); manifest=[]; seen=set(); errors=[]
  for slug,title,genre,filename,author,page in CANDIDATES:
   if len(manifest)==20: break
   raw=td/(slug+Path(filename).suffix.lower())
   try:
    print("Baixando:",title,"—",filename)
    download(filename,raw)
    digest=hashlib.sha256(raw.read_bytes()).hexdigest()
    if digest in seen:
     print("Ignorada: conteúdo repetido",title); continue
    seconds=duration(raw)
    if seconds<30:
     print("Ignorada: duração menor que 30 segundos",title,seconds); continue
    out_name=slug+".mp3"; out=MUSIC_DIR/out_name
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(raw),"-vn","-codec:a","libmp3lame","-b:a","128k","-ar","44100","-ac","2",str(out)],check=True)
    final_seconds=duration(out)
    if final_seconds<30:
     out.unlink(missing_ok=True); raise RuntimeError("conversão resultou em menos de 30 segundos")
    seen.add(digest)
    manifest.append({"id":slug,"name":title,"genre":genre,"src":f"assets/music/{out_name}","duration_seconds":round(final_seconds,2),"author":author,"license":"CC0 1.0","source":page})
    print(f"OK: {title} — {final_seconds:.1f}s")
   except Exception as exc:
    errors.append(f"{title}: {exc}"); print("Falhou; próxima faixa:",title,exc)
  if len(manifest)<20:
   raise RuntimeError(f"Apenas {len(manifest)} músicas válidas. Precisamos de 20. "+" | ".join(errors[-12:]))
 keep={Path(x["src"]).name for x in manifest}
 for old in MUSIC_DIR.glob("*.mp3"):
  if old.name not in keep: old.unlink(missing_ok=True)
 (MUSIC_DIR/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print("Biblioteca pronta:",len(manifest),"faixas; duração mínima:",min(x["duration_seconds"] for x in manifest))

def gradient(size,top,bottom):
 im=Image.new("RGB",(size,size)); pix=im.load()
 a=tuple(int(top[i:i+2],16) for i in (1,3,5)); b=tuple(int(bottom[i:i+2],16) for i in (1,3,5))
 for y in range(size):
  t=y/(size-1); c=tuple(int(a[k]*(1-t)+b[k]*t) for k in range(3))
  for x in range(size): pix[x,y]=c
 mask=Image.new("L",(size,size),0); ImageDraw.Draw(mask).rounded_rectangle((2,2,size-3,size-3),radius=30,fill=255)
 out=Image.new("RGB",(size,size),(7,11,24)); out.paste(im,(0,0),mask)
 return out

def emoji_gif(emoji,c1,c2,font_path,out):
 font=ImageFont.truetype(font_path,109); glyph=Image.new("RGBA",(170,145),(0,0,0,0))
 ImageDraw.Draw(glyph).text((0,-3),emoji,font=font,embedded_color=True)
 glyph=glyph.crop(glyph.getbbox()).resize((93,93),Image.Resampling.LANCZOS)
 frames=[]
 for frame in range(14):
  bob=round(math.sin(frame*math.tau/14)*3)
  im=gradient(128,c1,c2).convert("RGBA"); d=ImageDraw.Draw(im)
  d.ellipse((9,9,119,119),outline=(255,255,255,115),width=3)
  d.ellipse((15,15,113,113),outline=(255,255,255,30),width=2)
  angle=frame*math.tau/14; sx=64+int(math.cos(angle)*47); sy=64+int(math.sin(angle)*47)
  light=210 if frame%4<2 else 70
  d.line((sx-4,sy,sx+4,sy),fill=(255,255,255,light),width=2)
  d.line((sx,sy-4,sx,sy+4),fill=(255,255,255,light),width=2)
  im.alpha_composite(glyph,(17,16+bob))
  frames.append(im.convert("P",palette=Image.Palette.ADAPTIVE))
 frames[0].save(out,save_all=True,append_images=frames[1:],duration=100,loop=0,optimize=True,disposal=2)

def honey_gif(source,out):
 original=Image.open(source).convert("RGBA"); box=original.getchannel("A").getbbox()
 if box: original=original.crop(box)
 original.thumbnail((100,100),Image.Resampling.LANCZOS); frames=[]
 for frame in range(14):
  scale=1+.025*math.sin(frame*math.tau/14); size=(int(original.width*scale),int(original.height*scale))
  icon=original.resize(size,Image.Resampling.LANCZOS); im=Image.new("RGBA",(128,128),(0,0,0,0))
  im.alpha_composite(icon,((128-size[0])//2,(128-size[1])//2))
  if frame%7 in (0,1): ImageDraw.Draw(im).ellipse((99,21,106,28),fill=(255,255,225,230))
  frames.append(im.convert("P",palette=Image.Palette.ADAPTIVE))
 frames[0].save(out,save_all=True,append_images=frames[1:],duration=100,loop=0,optimize=True,disposal=2)

def bee_still(source,out):
 im=Image.open(source).convert("RGBA"); im.seek(0); w,h=im.size; side=min(w,h)
 im=im.crop(((w-side)//2,(h-side)//2,(w+side)//2,(h+side)//2)).resize((128,128),Image.Resampling.LANCZOS)
 mask=Image.new("L",(128,128),0); ImageDraw.Draw(mask).ellipse((2,2,126,126),fill=255)
 result=Image.new("RGBA",(128,128),(0,0,0,0)); result.paste(im,(0,0),mask)
 ImageDraw.Draw(result).ellipse((2,2,126,126),outline=(255,199,64,255),width=4); result.save(out)

def generate_avatars():
 AVATAR_DIR.mkdir(parents=True,exist_ok=True)
 fonts=[Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"),Path("/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf")]
 font=next((p for p in fonts if p.exists()),None)
 if not font: raise RuntimeError("Fonte Noto Emoji não encontrada")
 for slug,name,emoji,c1,c2 in EMOJIS:
  emoji_gif(emoji,c1,c2,str(font),AVATAR_DIR/f"gif-{slug}.gif")
 honey=AVATAR_DIR/"avatar-favo-mel.png"
 bee=AVATAR_DIR/"avatar-abelhinha-dancando.gif"
 if not honey.exists() or not bee.exists(): raise RuntimeError("Os arquivos de referência dos avatares não foram encontrados")
 honey_gif(honey,AVATAR_DIR/"gif-favo-mel.gif")
 bee_still(bee,AVATAR_DIR/"avatar-abelhinha-imagem.png")
 print("12 GIFs disponíveis (10 personagens, favo de mel e GIF da abelhinha) e 12 imagens.")

def main():
 parser=argparse.ArgumentParser(); parser.add_argument("--avatars-only",action="store_true"); args=parser.parse_args()
 if not args.avatars_only: import_music()
 generate_avatars()

if __name__=="__main__": main()
