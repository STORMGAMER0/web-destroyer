# Extract all sprites from a MUGEN SFF file (v1 or v2) into PNGs + axis index (json)
# usage: sff_extract.py <file.sff> <palette.act> <out_dir>
#   The .act palette is used by SFF v1 sprites that have no palette of their own;
#   SFF v2 files carry their own palettes, so it is ignored there.
import struct,sys,io,json,os
from PIL import Image
sff,act,out=sys.argv[1],sys.argv[2],sys.argv[3]
data=open(sff,'rb').read()
index={}

def save(img,g,im,ax,ay,linked):
    key=f'{g}_{im}'
    if key in index: return
    if img.mode=='P':
        # Colour index 0 is transparent
        rgba=img.convert('RGBA'); px=img.load(); w,h=img.size
        al=Image.new('L',img.size,255); ap=al.load()
        for y in range(h):
            for x in range(w):
                if px[x,y]==0: ap[x,y]=0
        rgba.putalpha(al)
    else: rgba=img.convert('RGBA')
    rgba.save(os.path.join(out,f'{key}.png'))
    index[key]={'g':g,'i':im,'ax':ax,'ay':ay,'w':rgba.width,'h':rgba.height,'linked':linked}

# ---------------------------------------------------------------- SFF v1 (PCX sprites)
def extract_v1():
    ngroups,nimages,off,subsize=struct.unpack('<IIII',data[16:32])
    a=open(act,'rb').read()[:768]
    actpal=[]
    for i in range(256):  # .act stored in reverse order
        j=255-i; actpal+= list(a[j*3:j*3+3])
    def decode_pcx(p,samepal):
        bpp=p[3]; x0,y0,x1,y1=struct.unpack('<HHHH',p[4:12]); planes=p[65]; bpl=struct.unpack('<H',p[66:68])[0]
        w,h=x1-x0+1,y1-y0+1; need=bpl*planes*h; out=bytearray(); i=128
        while len(out)<need and i<len(p):
            c=p[i]; i+=1
            if c>=0xC0: out+=bytes([p[i]])*(c&0x3F); i+=1
            else: out.append(c)
        out=bytes(out[:need]).ljust(need,b'\x00')
        if bpp==8 and planes==1:
            img=Image.frombytes('P',(w,h),b''.join(out[y*bpl:y*bpl+w] for y in range(h)))
            if not samepal and len(p)>=769 and p[-769]==12: img.putpalette(p[-768:])
            else: img.putpalette(actpal)
            return img
        rows=[]
        for y in range(h):
            r=out[y*bpl*planes:(y+1)*bpl*planes]
            rows.append(bytes(v for x in range(w) for v in (r[x],r[bpl+x],r[2*bpl+x])))
        return Image.frombytes('RGB',(w,h),b''.join(rows))
    # Pass 1: decode every sprite with the palette its file entry says to use
    # ("same palette" flags chain back to the last sprite that stored one)
    entries=[];last_pal=None;start=off
    for n in range(nimages):
        nxt,length,ax,ay,g,im,link,samepal=struct.unpack('<IIhhHHHB',data[off:off+19])
        if length==0:
            img=entries[link][0]
        else:
            img=decode_pcx(data[off+32:off+32+length],samepal)
            if img.mode=='P':
                if samepal and last_pal is not None: img.putpalette(last_pal)
                else: last_pal=img.getpalette()
        entries.append((img,g,im,ax,ay,length==0))
        off=nxt
        if off==0: break
    # Pass 2: like MUGEN, the chosen .act replaces the character's own palette (the one the
    # standing sprite 0,0 uses) on every sprite that shares it; effects keep their palettes
    char_pal=next((e[0].getpalette() for e in entries if e[1]==0 and e[2]==0 and e[0].mode=='P'),None)
    for img,g,im,ax,ay,linked in entries:
        if img.mode=='P' and char_pal is not None and img.getpalette()==char_pal:
            img=img.copy(); img.putpalette(actpal)
        save(img,g,im,ax,ay,linked)
    return nimages

# ---------------------------------------------------------------- SFF v2
# Decoders follow IKEMEN GO's (src/image.go): RLE8, RLE5, LZ5 and PNG sprites.
def rle8(src,size):
    p=bytearray(); i=0
    while len(p)<size and i<len(src):
        d=src[i]; i+=1
        if d&0xc0==0x40:
            p+=bytes([src[i] if i<len(src) else 0])*(d&0x3f); i+=1
        else: p.append(d)
    return bytes(p[:size]).ljust(size,b'\0')

def rle5(src,size):
    p=bytearray(); i=0
    while len(p)<size and i+1<len(src):
        rl=src[i]; dl=src[i+1]&0x7f; color=0
        if src[i+1]&0x80: color=src[i+2]; i+=3
        else: i+=2
        p+=bytes([color])*(rl+1)
        for _ in range(dl):
            d=src[i]; i+=1
            p+=bytes([d&0x1f])*((d>>5)+1)
    return bytes(p[:size]).ljust(size,b'\0')

def lz5(src,size):
    p=bytearray(size)
    if not src: return bytes(p)
    i=j=0; last=len(src)-1
    ct=src[0]; cts=0; rb=0; rbc=0
    if i<last: i+=1
    while j<size:
        d=src[i]
        if i<last: i+=1
        if ct&(1<<cts):
            # Back-reference: copy n+1 bytes from d bytes back
            if d&0x3f==0:
                d=((d<<2)|src[i])+1
                if i<last: i+=1
                n=src[i]+2
                if i<last: i+=1
            else:
                rb|=(d&0xc0)>>rbc; rbc+=2
                n=d&0x3f
                if rbc<8:
                    d=src[i]+1
                    if i<last: i+=1
                else:
                    d=rb+1; rb=rbc=0
            while True:
                if j<size: p[j]=p[j-d]; j+=1
                n-=1
                if n<0: break
        else:
            # Run of one colour
            if d&0xe0==0:
                n=src[i]+8
                if i<last: i+=1
            else:
                n=d>>5; d&=0x1f
            while n>0:
                if j<size: p[j]=d; j+=1
                n-=1
        cts+=1
        if cts>=8:
            ct=src[i]; cts=0
            if i<last: i+=1
    return bytes(p)

def extract_v2():
    spr_off,nspr,pal_off,npal,ld_off,ld_len,td_off,td_len=struct.unpack('<IIIIIIII',data[0x24:0x44])
    palettes=[]
    for k in range(npal):
        g,it,ncol,link,ofs,size=struct.unpack('<HHHHII',data[pal_off+k*16:pal_off+k*16+16])
        if size==0:
            palettes.append(palettes[link]); continue
        raw=data[ld_off+ofs:ld_off+ofs+size]
        pal=[]
        for c in range(256):
            pal+=list(raw[c*4:c*4+3]) if c*4+3<=len(raw) else [0,0,0]
        palettes.append(pal)
    imgs=[]
    for k in range(nspr):
        o=spr_off+k*28
        g,im,w,h,ax,ay,link,fmt,depth,doff,dlen,pal,flags=struct.unpack('<HHHHhhHBBIIHH',data[o:o+28])
        if dlen==0:
            img=imgs[link]
        else:
            base=(td_off if flags&1 else ld_off)+doff
            raw=data[base:base+dlen]
            if fmt in (10,11,12):
                img=Image.open(io.BytesIO(raw[4:])); img.load()
                if fmt==10 and img.mode=='P': img.putpalette(palettes[pal])
            else:
                body=raw if fmt==0 else raw[4:]
                px={0:lambda s,n:bytes(s[:n]).ljust(n,b'\0'),2:rle8,3:rle5,4:lz5}[fmt](body,w*h)
                img=Image.frombytes('P',(w,h),px); img.putpalette(palettes[pal])
        imgs.append(img)
        save(img,g,im,ax,ay,dlen==0)
    return nspr

version=data[15]
total=extract_v2() if version==2 else extract_v1()
json.dump(index,open(os.path.join(out,'_index.json'),'w'))
print(total,len(index),len({v['g'] for v in index.values()}))
