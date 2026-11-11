// Three suns + four planets on a spacetime fabric, with real texture maps, logo and watermark.
// Usage: node render4.js video <out.mp4> [a-b] | node render4.js still <out%d.png> <f1,f2,...>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const { simulate } = require('./sim5.js');

const W = 1080, H = 1920, FPS = 30, SECONDS = 20, FRAMES = FPS * SECONDS, SUB = 20;
const SEED = 4664, SIM_T = 22;
const [mode, outPath, frameArg] = process.argv.slice(2);
const deg = d => d * Math.PI / 180;
// planets on physically simulated orbits around the whole triple (picked by sim5.js search)
const PLANETS = [
  { name: 'earth', r: 1.5, dir: -1, phase: deg(120), rad: 0.072, tilt: 0.41, spin: 2.2, trail: [110, 170, 255], atm: [90, 150, 255] },
  { name: 'mars', r: 1.65, dir: -1, phase: deg(290), rad: 0.074, tilt: 0.44, spin: 2.0, trail: [255, 140, 100], atm: [255, 150, 110] },
  { name: 'jupiter', r: 2.0, dir: -1, phase: deg(200), rad: 0.088, tilt: 0.05, spin: 3.2, trail: [235, 200, 160], atm: null },
  { name: 'saturn', r: 2.2, dir: -1, phase: deg(10), rad: 0.074, tilt: 0.47, spin: 3.0, trail: [240, 220, 170], atm: null, ring: true },
];
const sim = simulate(SEED, SIM_T, FRAMES * SUB, PLANETS);
console.error('planet min star distance', Array.from(sim.dmin, v => v.toFixed(2)).join(' '), 'r range', Array.from(sim.rmin, (v, i) => v.toFixed(2) + '-' + sim.rmax[i].toFixed(2)).join(' '));
const P = Array.from(sim.pts, v => +v.toFixed(4));

const TEXDIR = __dirname + '/npmprobe/wk/package/dist/textures/';
const dataUrl = (p, mime) => `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
const ASSETS = {
  sun: dataUrl(TEXDIR + 'sun-1024.webp', 'image/webp'), earth: dataUrl(TEXDIR + 'earth-1024.webp', 'image/webp'),
  mars: dataUrl(TEXDIR + 'mars-1024.webp', 'image/webp'), jupiter: dataUrl(TEXDIR + 'jupiter-1024.webp', 'image/webp'),
  saturn: dataUrl(TEXDIR + 'saturn-1024.webp', 'image/webp'), ring: dataUrl(TEXDIR + 'saturn-ring-2048.webp', 'image/webp'),
  logo: dataUrl(process.env.LOGO || '/root/.claude/uploads/e0aee46c-30ef-5e50-bc08-cb9823539fcb/e5dd7880-image.png', 'image/png'),
};

const pageScript = `
const W=${W},H=${H},FPS=${FPS},FRAMES=${FRAMES},SUB=${SUB},V=${sim.V};
const P=${JSON.stringify(P)};
const PLANETS=${JSON.stringify(PLANETS)};
const ASSETS=${JSON.stringify(ASSETS)};
const COLORS=[[255,186,84],[92,206,255],[255,96,150]];
const SUNTINT=[[255,172,64],[104,196,255],[255,100,146]];
const SUNR=0.104;
const cv=document.getElementById('c'),ctx=cv.getContext('2d');
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
let seed=11;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const ease=t=>t*t*(3-2*t),clamp=(v,a,b)=>v<a?a:v>b?b:v,sstep=(a,b,v)=>ease(clamp((v-a)/(b-a),0,1));

// ---- background
const bg=mk(W,H);{const g=bg.getContext('2d');
  let gr=g.createLinearGradient(0,0,0,H);
  gr.addColorStop(0,'#03040c');gr.addColorStop(0.45,'#070a1c');gr.addColorStop(1,'#020208');
  g.fillStyle=gr;g.fillRect(0,0,W,H);
  g.globalCompositeOperation='lighter';
  for(const [x,y,r,col] of [[200,330,760,'rgba(90,56,190,0.16)'],[900,560,700,'rgba(20,110,160,0.13)'],[560,150,520,'rgba(200,70,120,0.07)'],[540,1250,900,'rgba(30,50,150,0.10)']]){
    gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,col);gr.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=gr;g.fillRect(0,0,W,H);}
  const id=g.getImageData(0,0,W,H),d=id.data;
  for(let i=0;i<d.length;i+=4){const nz=(rnd()-0.5)*5;d[i]+=nz;d[i+1]+=nz;d[i+2]+=nz;}
  g.putImageData(id,0,0);}
const SKY=[];for(let i=0;i<16000;i++){const u=rnd()*2-1,a=rnd()*6.2832,q=Math.sqrt(1-u*u);
  SKY.push([q*Math.cos(a),u,q*Math.sin(a),0.6+Math.pow(rnd(),5)*2.6,0.4+rnd()*0.6,rnd()*6.28,0.6+rnd()*2.4,rnd()]);}

function glowSprite(r,g,b){const s=mk(512,512),x=s.getContext('2d');
  const gr=x.createRadialGradient(256,256,0,256,256,256);
  gr.addColorStop(0,'rgba('+r+','+g+','+b+',0.85)');gr.addColorStop(0.1,'rgba('+r+','+g+','+b+',0.42)');
  gr.addColorStop(0.3,'rgba('+r+','+g+','+b+',0.12)');gr.addColorStop(0.6,'rgba('+r+','+g+','+b+',0.03)');gr.addColorStop(1,'rgba('+r+','+g+','+b+',0)');
  x.fillStyle=gr;x.fillRect(0,0,512,512);return s;}
const GLOW=COLORS.map(c=>glowSprite(...c));

// ---- camera
let CR,CU,CF,CP;const FOC=1620,SCX=W/2,SCY=905;
function setCam(az,el,dist,ty){
  const ce=Math.cos(el),se=Math.sin(el);
  CP=[dist*ce*Math.sin(az),ty+dist*se,dist*ce*Math.cos(az)];
  let f=[-CP[0],ty-CP[1],-CP[2]];const fl=Math.hypot(...f);CF=f.map(v=>v/fl);
  let r=[-CF[2],0,CF[0]];const rl=Math.hypot(...r);CR=r.map(v=>v/rl);
  CU=[CR[1]*CF[2]-CR[2]*CF[1],CR[2]*CF[0]-CR[0]*CF[2],CR[0]*CF[1]-CR[1]*CF[0]];}
const out=[0,0,0];
function proj(x,y,z){const vx=x-CP[0],vy=y-CP[1],vz=z-CP[2];
  const zc=vx*CF[0]+vy*CF[1]+vz*CF[2];
  out[0]=SCX+FOC*(vx*CR[0]+vy*CR[1]+vz*CR[2])/zc;out[1]=SCY-FOC*(vx*CU[0]+vy*CU[1]+vz*CU[2])/zc;out[2]=zc;return out;}

// ---- fabric: suns press deep funnels, planets small dimples
const WA=0.118,WE=0.2,PA=0.0075,PE=0.065;let S=[[0,0],[0,0],[0,0]],PL=PLANETS.map(()=>[0,0]);
function height(x,z){let h=0;
  for(let i=0;i<3;i++){const dx=x-S[i][0],dz=z-S[i][1];h-=WA/Math.sqrt(dx*dx+dz*dz+WE*WE);}
  for(let i=0;i<PL.length;i++){const dx=x-PL[i][0],dz=z-PL[i][1],q=dx*dx+dz*dz;if(q<0.5)h-=PA/Math.sqrt(q+PE*PE)-PA/Math.sqrt(0.5+PE*PE);}
  return h;}

const layer=mk(W,H),lx=layer.getContext('2d');
const GR=4.3,GS=0.11,GN=Math.round(GR/GS),STEP=GS/3;
function gridLine(fixed,alongX){
  const nS=Math.round(2*GR/STEP);let px=0,py=0,have=false;
  for(let k=0;k<=nS;k++){const t=-GR+k*STEP,x=alongX?t:fixed,z=alongX?fixed:t;
    const rr=Math.hypot(x,z);if(rr>GR){have=false;continue;}
    const h=height(x,z);proj(x,h,z);const sx=out[0],sy=out[1],zc=out[2];
    if(zc<0.3){have=false;continue;}
    if(have&&!((sx<-60&&px<-60)||(sx>W+60&&px>W+60)||(sy>H+60&&py>H+60)||(sy<-60&&py<-60))){
      let r=46,g=92,b=235,a=0.34,tw=0;
      for(let i=0;i<3;i++){const dx=x-S[i][0],dz=z-S[i][1],w=0.075/(dx*dx+dz*dz+0.075);
        r+=COLORS[i][0]*w*0.85;g+=COLORS[i][1]*w*0.85;b+=COLORS[i][2]*w*0.85;tw+=w;}
      a=(a+0.5*Math.min(1,tw))*sstep(GR,GR*0.5,rr)*clamp(1.6-zc/6.8,0.2,1);
      if(a>0.012){lx.strokeStyle='rgba('+Math.min(255,r|0)+','+Math.min(255,g|0)+','+Math.min(255,b|0)+','+a.toFixed(3)+')';
        lx.lineWidth=clamp(6.2/zc,0.7,2.6);lx.beginPath();lx.moveTo(px,py);lx.lineTo(sx,sy);lx.stroke();}}
    px=sx;py=sy;have=true;}}

function trail(b,head,rgb,tau,maxAge,w0,amp){
  const span=Math.min(head,Math.round(maxAge*FPS*SUB)),CH=4;
  for(let i=head-span;i<head;i+=CH){const e=Math.min(i+CH,head);
    const age=(head-(i+e)/2)/(SUB*FPS),a=Math.exp(-age/tau)*amp;if(a<0.01)continue;
    lx.beginPath();let zc=1;
    for(let k=i;k<=e;k++){const x=P[k*V+b*2],z=P[k*V+b*2+1];proj(x,height(x,z)+0.012,z);
      if(k===i)lx.moveTo(out[0],out[1]);else lx.lineTo(out[0],out[1]);zc=out[2];}
    lx.strokeStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+a.toFixed(3)+')';
    lx.lineWidth=clamp(w0*(0.35+0.65*Math.exp(-age/(tau*0.6)))/zc,0.8,9);lx.stroke();}}

// ---- textured spheres, rasterised per pixel from the equirectangular maps
const TEX={};
function sample(t,u,v,o){ // bilinear, u wraps
  const fx=(u-Math.floor(u))*t.w-0.5,fy=clamp(v,0,1)*(t.h-1);
  let x0=Math.floor(fx),y0=Math.floor(fy);const ax=fx-x0,ay=fy-y0;
  const x1=(x0+1+t.w)%t.w;x0=(x0+t.w)%t.w;const y1=Math.min(t.h-1,y0+1);
  const d=t.d,i00=(y0*t.w+x0)*4,i10=(y0*t.w+x1)*4,i01=(y1*t.w+x0)*4,i11=(y1*t.w+x1)*4;
  for(let c=0;c<3;c++)o[c]=(d[i00+c]*(1-ax)+d[i10+c]*ax)*(1-ay)+(d[i01+c]*(1-ax)+d[i11+c]*ax)*ay;}
const scratch=mk(4,4),sctx=scratch.getContext('2d'),tc=[0,0,0];
// lights: [[dx,dy,dz,r,g,b]] in world space (planets). tint: sun colour (emissive).
function drawSphere(tex,cx,cy,R,spin,tilt,lights,tint,atm){
  const n=Math.ceil(R)+2,sz=2*n;if(scratch.width!==sz){scratch.width=sz;scratch.height=sz;}
  const id=sctx.createImageData(sz,sz),d=id.data,ct=Math.cos(tilt),st=Math.sin(tilt);
  const fx=cx-Math.floor(cx),fy=cy-Math.floor(cy);
  for(let py=0;py<sz;py++)for(let px=0;px<sz;px++){
    const u=(px+0.5-n-fx)/R,w=-(py+0.5-n-fy)/R,rr=Math.sqrt(u*u+w*w);
    const al=clamp((1-rr)*R+0.5,0,1);if(al<=0)continue;
    const k=rr>0.999?0.999/rr:1,uu=u*k,ww=w*k,q=Math.sqrt(Math.max(0,1-uu*uu-ww*ww));
    const nx=uu*CR[0]+ww*CU[0]-q*CF[0],ny=uu*CR[1]+ww*CU[1]-q*CF[1],nz=uu*CR[2]+ww*CU[2]-q*CF[2];
    const y1=ny*ct-nz*st,z1=ny*st+nz*ct;
    sample(tex,(Math.atan2(nx,z1)+spin)/6.283185+0.5,0.5-Math.asin(clamp(y1,-1,1))/3.141593,tc);
    let r,g,b;
    if(tint){const l=(0.3*tc[0]+0.59*tc[1]+0.11*tc[2])/255,base=0.3+1.1*l,wh=Math.pow(l,2.3)*0.8,limb=0.6+0.4*Math.pow(q,0.7);
      r=(tint[0]*base*(1-wh)+255*wh)*limb;g=(tint[1]*base*(1-wh)+255*wh)*limb;b=(tint[2]*base*(1-wh)+255*wh)*limb;}
    else{const hl=0.22+0.5*q;let lr=hl,lg=hl,lb=hl*1.04;
      for(const L of lights){const dd=nx*L[0]+ny*L[1]+nz*L[2];if(dd>0){lr+=dd*L[3];lg+=dd*L[4];lb+=dd*L[5];}}
      r=tc[0]*lr;g=tc[1]*lg;b=tc[2]*lb;
      if(atm){const rim=Math.pow(1-q,2.2)*0.9*Math.min(1,(lr+lg+lb)/2.2);r+=atm[0]*rim;g+=atm[1]*rim;b+=atm[2]*rim;}}
    const o=(py*sz+px)*4;d[o]=r>255?255:r;d[o+1]=g>255?255:g;d[o+2]=b>255?255:b;d[o+3]=al*255;}
  sctx.putImageData(id,0,0);ctx.drawImage(scratch,Math.floor(cx)-n,Math.floor(cy)-n);}

let RING=null;const RIN=1.241,ROUT=2.274;
function buildRing(strip){RING=mk(512,512);const x=RING.getContext('2d'),id=x.createImageData(512,512),d=id.data;
  for(let py=0;py<512;py++)for(let px=0;px<512;px++){const rho=Math.hypot(px-255.5,py-255.5)/256*ROUT,t=(rho-RIN)/(ROUT-RIN);
    if(t<0||t>1)continue;const s=Math.min(2047,Math.round(t*2047))*4,o=(py*512+px)*4;
    d[o]=strip.d[s];d[o+1]=strip.d[s+1];d[o+2]=strip.d[s+2];d[o+3]=Math.min(255,strip.d[s+3]*1.25)*sstep(0,0.02,t)*sstep(1,0.985,t);}
  x.putImageData(id,0,0);}
function drawRingHalf(cx,cy,Rpx,tilt,far,bright){
  const ct=Math.cos(tilt),st=Math.sin(tilt),a=[1,0,0],b=[0,-st,-ct],k=Rpx*ROUT/256;
  const ax=(a[0]*CR[0]+a[1]*CR[1]+a[2]*CR[2])*k,ay=-(a[0]*CU[0]+a[1]*CU[1]+a[2]*CU[2])*k;
  const bx=(b[0]*CR[0]+b[1]*CR[1]+b[2]*CR[2])*k,by=-(b[0]*CU[0]+b[1]*CU[1]+b[2]*CU[2])*k;
  let gx=a[0]*CF[0]+a[1]*CF[1]+a[2]*CF[2],gy=b[0]*CF[0]+b[1]*CF[1]+b[2]*CF[2];const gl=Math.hypot(gx,gy)||1;gx/=gl;gy/=gl;
  if(!far){gx=-gx;gy=-gy;}
  ctx.save();ctx.setTransform(ax,ay,bx,by,cx,cy);
  ctx.beginPath();ctx.moveTo(-gy*600,gx*600);ctx.lineTo(gy*600,-gx*600);ctx.lineTo(gy*600+gx*600,-gx*600+gy*600);ctx.lineTo(-gy*600+gx*600,gx*600+gy*600);ctx.closePath();ctx.clip();
  ctx.globalAlpha=bright;ctx.drawImage(RING,-256,-256);ctx.restore();}

// ---- logo (tinted with the reel's three colours) + watermark
let LOGO=null;const LOGO_H=112,LOGO_X=60,LOGO_Y=296;
function buildLogo(img){const bx=307,by=258,bw=472,bh=519,h=LOGO_H,w=Math.round(bw*h/bh);
  const c=mk(w,h),x=c.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(img,bx,by,bw,bh,0,0,w,h);
  x.globalCompositeOperation='source-in';const g=x.createLinearGradient(0,h,w,0);
  g.addColorStop(0,'rgb(120,214,255)');g.addColorStop(0.55,'rgb(255,150,190)');g.addColorStop(1,'rgb(255,206,128)');
  x.fillStyle=g;x.fillRect(0,0,w,h);LOGO=c;}
const WM='@spaceman.in';

window.init=async function(){
  const load=src=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});
  for(const k of ['sun','earth','mars','jupiter','saturn','ring']){const im=await load(ASSETS[k]);
    const c=mk(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);TEX[k]={w:im.width,h:im.height,d:x.getImageData(0,0,im.width,im.height).data};}
  buildRing(TEX.ring);buildLogo(await load(ASSETS.logo));await document.fonts.ready;return true;};

window.drawFrame=function(f){
  const t=f/(FRAMES-1),head=f*SUB,sec=f/FPS;
  for(let i=0;i<3;i++)S[i]=[P[head*V+i*2],P[head*V+i*2+1]];
  for(let i=0;i<PL.length;i++)PL[i]=[P[head*V+6+i*2],P[head*V+7+i*2]];
  setCam(CAM.az0+CAM.az1*t,CAM.el0+(CAM.el1-CAM.el0)*ease(t),CAM.d0+(CAM.d1-CAM.d0)*ease(t),CAM.ty);

  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.filter='none';
  ctx.drawImage(bg,0,0);
  ctx.globalCompositeOperation='lighter';
  for(const s of SKY){const zc=s[0]*CF[0]+s[1]*CF[1]+s[2]*CF[2];if(zc<0.5)continue;
    const x=SCX+FOC*(s[0]*CR[0]+s[1]*CR[1]+s[2]*CR[2])/zc,y=SCY-FOC*(s[0]*CU[0]+s[1]*CU[1]+s[2]*CU[2])/zc;
    if(x<-4||x>W+4||y<-4||y>H+4)continue;
    const a=s[4]*(0.7+0.3*Math.sin(s[5]+s[6]*sec*2));
    ctx.fillStyle=s[7]<0.15?'rgba(255,212,168,'+a.toFixed(3)+')':s[7]<0.4?'rgba(168,204,255,'+a.toFixed(3)+')':'rgba(255,255,255,'+a.toFixed(3)+')';
    ctx.beginPath();ctx.arc(x,y,s[3],0,6.2832);ctx.fill();}

  lx.setTransform(1,0,0,1,0,0);lx.globalCompositeOperation='source-over';lx.clearRect(0,0,W,H);
  lx.globalCompositeOperation='lighter';lx.lineCap='round';lx.lineJoin='round';
  for(let i=-GN;i<=GN;i++){gridLine(i*GS,true);gridLine(i*GS,false);}
  for(let b=0;b<3;b++)trail(b,head,COLORS[b],1.6,7.5,24,0.95);
  for(let i=0;i<PLANETS.length;i++)trail(3+i,head,PLANETS[i].trail,1.1,5,8,0.6);
  ctx.filter='blur(16px)';ctx.globalAlpha=0.85;ctx.drawImage(layer,0,0);
  ctx.filter='blur(4px)';ctx.globalAlpha=0.6;ctx.drawImage(layer,0,0);
  ctx.filter='none';ctx.globalAlpha=1;ctx.drawImage(layer,0,0);

  // bodies, far to near
  const S3=S.map(s=>[s[0],height(s[0],s[1])+SUNR*0.7,s[1]]);
  const bodies=[];
  for(let i=0;i<3;i++){proj(S3[i][0],S3[i][1],S3[i][2]);bodies.push({sun:i,x:out[0],y:out[1],z:out[2]});}
  for(let i=0;i<PLANETS.length;i++){const p=PLANETS[i],w=[PL[i][0],height(PL[i][0],PL[i][1])+p.rad*0.75,PL[i][1]];proj(w[0],w[1],w[2]);
    if(out[2]>0.5)bodies.push({pl:i,w,x:out[0],y:out[1],z:out[2]});}
  bodies.sort((a,b)=>b.z-a.z);
  for(const o of bodies){const k=FOC/o.z;
    if(o.sun!==undefined){const i=o.sun,g=1.45*k;
      ctx.globalCompositeOperation='lighter';
      ctx.globalAlpha=0.9;ctx.drawImage(GLOW[i],o.x-g/2,o.y-g/2,g,g);
      ctx.globalAlpha=0.9;ctx.drawImage(GLOW[i],o.x-g*0.2,o.y-g*0.2,g*0.4,g*0.4);
      for(const [sw,sh] of [[2.2*k,0.013*k],[0.013*k,1.35*k]]){ctx.globalAlpha=0.4;ctx.drawImage(GLOW[i],o.x-sw/2,o.y-sh/2,sw,sh);}
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      drawSphere(TEX.sun,o.x,o.y,SUNR*k,0.5*sec+i*2.1,0.25+i*0.5,null,SUNTINT[i],null);}
    else{const p=PLANETS[o.pl],R=p.rad*k;
      if(o.x<-4*R||o.x>W+4*R||o.y<-4*R||o.y>H+4*R)continue;
      // each sun lights the planet with its own colour, weighted by how close it is
      const lights=[];let ws=0;
      for(let i=0;i<3;i++){const dx=S3[i][0]-o.w[0],dy=S3[i][1]+0.25-o.w[1],dz=S3[i][2]-o.w[2],dd=dx*dx+dy*dy+dz*dz,l=Math.sqrt(dd),wt=1/(dd+0.3);ws+=wt;
        lights.push([dx/l,dy/l,dz/l,(COLORS[i][0]*0.5+127)/255*wt,(COLORS[i][1]*0.5+127)/255*wt,(COLORS[i][2]*0.5+127)/255*wt]);}
      for(const L of lights){L[3]*=1.1/ws;L[4]*=1.1/ws;L[5]*=1.1/ws;}
      ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
      if(p.ring)drawRingHalf(o.x,o.y,R,p.tilt,true,0.92);
      drawSphere(TEX[p.name],o.x,o.y,R,p.spin*sec+o.pl,p.tilt,lights,null,p.atm);
      if(p.ring)drawRingHalf(o.x,o.y,R,p.tilt,false,0.92);}}

  // vignette
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  const vg=ctx.createRadialGradient(W/2,H*0.47,H*0.3,W/2,H*0.47,H*0.72);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,0.55)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);

  // watermark: slow DVD-style bounce inside the area Instagram's UI leaves clear
  ctx.font='600 30px Inter,"DejaVu Sans",sans-serif';ctx.textBaseline='top';
  const tw=ctx.measureText(WM).width,tri=(v,span)=>{const m=((v%(2*span))+2*span)%(2*span);return m<span?m:2*span-m;};
  const bx0=56,bx1=W-150-tw,by0=470,by1=1470;
  const wx=bx0+tri(180+58*sec,bx1-bx0),wy=by0+tri(240+43*sec,by1-by0);
  ctx.shadowColor='rgba(0,0,0,0.6)';ctx.shadowBlur=6;ctx.fillStyle='rgba(255,255,255,0.36)';ctx.fillText(WM,wx,wy);
  ctx.shadowColor='transparent';ctx.shadowBlur=0;

  // logo, top-left inside the safe zone (below the Reels header, inside the 4:5 feed crop)
  ctx.globalCompositeOperation='lighter';ctx.filter='blur(10px)';ctx.globalAlpha=0.5;ctx.drawImage(LOGO,LOGO_X,LOGO_Y);
  ctx.filter='none';ctx.globalCompositeOperation='source-over';ctx.globalAlpha=0.95;ctx.drawImage(LOGO,LOGO_X,LOGO_Y);ctx.globalAlpha=1;

  const fade=Math.min(1,sec/0.6,(FRAMES-1-f)/FPS/0.45);
  if(fade<1){ctx.fillStyle='rgba(0,0,0,'+(1-ease(Math.max(0,fade))).toFixed(3)+')';ctx.fillRect(0,0,W,H);}
};`;

const CAM = JSON.parse(process.env.CAM || '{"az0":0.55,"az1":0.95,"el0":0.74,"el1":0.64,"d0":4.7,"d1":4.15,"ty":-0.3}');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.setContent(`<html><body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}" style="display:block"></canvas></body></html>`);
  await page.addScriptTag({ content: `const CAM=${JSON.stringify(CAM)};` + pageScript });
  await page.evaluate(() => window.init());
  if (mode === 'still') {
    for (const f of String(frameArg).split(',')) {
      const t0 = Date.now();
      await page.evaluate(f => window.drawFrame(f), +f);
      await page.screenshot({ path: outPath.replace('%d', f) });
      console.error('frame', f, Date.now() - t0, 'ms');
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', outPath],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise(r => ff.on('close', r));
    const [a, b] = (frameArg || `0-${FRAMES}`).split('-').map(Number);
    for (let f = a; f < b; f++) {
      await page.evaluate(f => window.drawFrame(f), f);
      const buf = await page.screenshot({ type: 'png' });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 50 === 0) console.error('frame', f);
    }
    ff.stdin.end();
    console.error('ffmpeg exit', await done);
  }
  await browser.close();
})();
