/* Alone2Lone profile media + cropper features. */

function compressImage(file,maxSize=512,quality=.82){
  return new Promise((resolve,reject)=>{
    const img=new Image(); const reader=new FileReader();
    reader.onload=()=>{img.onload=()=>{const scale=Math.min(1,maxSize/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const ctx=c.getContext("2d");ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",quality));};img.onerror=reject;img.src=reader.result;};
    reader.onerror=reject;reader.readAsDataURL(file);
  });
}
let cropImageState={img:null,scale:1,minScale:1,offsetX:0,offsetY:0,rotation:0,file:null,pointers:new Map(),gesture:null};
function openCropper(file){
  if(!file||!String(file.type||'').startsWith('image/'))return;
  const reader=new FileReader();
  reader.onload=()=>{const img=new Image();img.onload=()=>{const canvas=$("profileCropCanvas"),size=canvas.width;const fit=Math.max(size/img.width,size/img.height);cropImageState={img,scale:fit,minScale:fit,offsetX:(size-img.width*fit)/2,offsetY:(size-img.height*fit)/2,rotation:0,file,pointers:new Map(),gesture:null};drawCrop();$("profileCropModal").hidden=false;$("profileCropModal").setAttribute("aria-hidden","false");};img.onerror=()=>toast("Could not open that photo");img.src=reader.result;};reader.onerror=()=>toast("Could not read that photo");reader.readAsDataURL(file);
}
function drawCrop(){
  const c=$("profileCropCanvas"),ctx=c.getContext("2d"),s=c.width,img=cropImageState.img;if(!img)return;
  ctx.clearRect(0,0,s,s);ctx.fillStyle="#08090d";ctx.fillRect(0,0,s,s);
  ctx.save();ctx.translate(s/2,s/2);ctx.rotate((cropImageState.rotation||0)*Math.PI/180);
  const x=cropImageState.offsetX-s/2,y=cropImageState.offsetY-s/2;ctx.drawImage(img,x,y,img.width*cropImageState.scale,img.height*cropImageState.scale);ctx.restore();
}
function resetCrop(){
  const st=cropImageState,img=st.img;if(!img)return;const size=$("profileCropCanvas").width,fit=Math.max(size/img.width,size/img.height);st.scale=fit;st.minScale=fit;st.offsetX=(size-img.width*fit)/2;st.offsetY=(size-img.height*fit)/2;st.rotation=0;st.pointers.clear();st.gesture=null;drawCrop();
}
function applyCrop(){
  const st=cropImageState;if(!st.img)return;const source=$("profileCropCanvas"),out=document.createElement("canvas"),size=512;out.width=out.height=size;const ctx=out.getContext("2d");ctx.drawImage(source,0,0,size,size);state.profile.photoData=out.toDataURL("image/jpeg",.88);save();closeCropper();renderProfile();toast("Profile photo updated 📸");
}
function closeCropper(){const m=$("profileCropModal");if(!m)return;m.hidden=true;m.setAttribute("aria-hidden","true");cropImageState={img:null,scale:1,minScale:1,offsetX:0,offsetY:0,rotation:0,file:null,pointers:new Map(),gesture:null};}
function pointFromEvent(e){const r=$("profileCropCanvas").getBoundingClientRect();const sx=$("profileCropCanvas").width/r.width,sy=$("profileCropCanvas").height/r.height;return{x:(e.clientX-r.left)*sx,y:(e.clientY-r.top)*sy};}
function distance(a,b){return Math.hypot(b.x-a.x,b.y-a.y)||1;}
function angle(a,b){return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;}
function midpoint(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
function shortestAngleDelta(now,start){return ((now-start+540)%360)-180;}
function setupCropper(){
  const stage=$("profileCropStage"),canvas=$("profileCropCanvas");if(!stage||!canvas)return;
  const beginPan=p=>{cropImageState.gesture={type:"pan",start:p,offsetX:cropImageState.offsetX,offsetY:cropImageState.offsetY};};
  const beginTransform=(a,b)=>{cropImageState.gesture={type:"transform",lastA:{...a},lastB:{...b},lastDistance:distance(a,b),lastAngle:angle(a,b)};};
  stage.addEventListener("pointerdown",e=>{
    if(!cropImageState.img)return;e.preventDefault();try{stage.setPointerCapture?.(e.pointerId);}catch(_){ }
    cropImageState.pointers.set(e.pointerId,pointFromEvent(e));const pts=[...cropImageState.pointers.values()];
    if(pts.length===1)beginPan(pts[0]);else if(pts.length===2)beginTransform(pts[0],pts[1]);
  },{passive:false});
  stage.addEventListener("pointermove",e=>{
    if(!cropImageState.img||!cropImageState.pointers.has(e.pointerId))return;e.preventDefault();
    cropImageState.pointers.set(e.pointerId,pointFromEvent(e));const pts=[...cropImageState.pointers.values()],g=cropImageState.gesture,size=canvas.width;if(!g)return;
    if(pts.length===1&&g.type==="pan"){cropImageState.offsetX=g.offsetX+(pts[0].x-g.start.x);cropImageState.offsetY=g.offsetY+(pts[0].y-g.start.y);drawCrop();return;}
    if(pts.length>=2&&g.type==="transform"){
      const a=pts[0],b=pts[1],mid=midpoint(a,b),prevMid=midpoint(g.lastA,g.lastB);
      const rawDist=distance(a,b),ratio=rawDist/Math.max(1,g.lastDistance);
      const nextScale=Math.max(cropImageState.minScale,Math.min(cropImageState.minScale*4,cropImageState.scale*ratio));
      const rawDelta=shortestAngleDelta(angle(a,b),g.lastAngle);
      const limitedDelta=Math.max(-6,Math.min(6,rawDelta));
      const rotationDelta=limitedDelta*0.58;
      // Incremental rotation: there is no fixed start point. Every frame uses the
      // fingers' current relative angle, so rotation can begin from any touch position.
      cropImageState.rotation+=rotationDelta;
      const rad=rotationDelta*Math.PI/180;
      const relX=cropImageState.offsetX-(prevMid.x-size/2),relY=cropImageState.offsetY-(prevMid.y-size/2);
      const cos=Math.cos(rad),sin=Math.sin(rad),rotX=relX*cos-relY*sin,rotY=relX*sin+relY*cos;
      const scaleRatio=nextScale/Math.max(0.0001,cropImageState.scale);
      cropImageState.scale=nextScale;
      cropImageState.offsetX=(mid.x-size/2)+rotX*scaleRatio;
      cropImageState.offsetY=(mid.y-size/2)+rotY*scaleRatio;
      g.lastA={...a};g.lastB={...b};g.lastDistance=rawDist;g.lastAngle=angle(a,b);drawCrop();
    }
  },{passive:false});
  const endPointer=e=>{
    cropImageState.pointers.delete(e.pointerId);const pts=[...cropImageState.pointers.values()];
    if(!pts.length){cropImageState.gesture=null;return;}if(pts.length===1){beginPan(pts[0]);return;}if(pts.length>=2)beginTransform(pts[0],pts[1]);
  };
  stage.addEventListener("pointerup",endPointer);stage.addEventListener("pointercancel",endPointer);stage.addEventListener("lostpointercapture",endPointer);
  $("profileCropReset").onclick=resetCrop;$("profileCropApply").onclick=applyCrop;$("profileCropCancel").onclick=closeCropper;$("profileCropBackdrop").onclick=closeCropper;
}
function handleProfilePhoto(file){if(!file||!file.type.startsWith("image/"))return;openCropper(file);}
function setupMediaFeatures(){
  $('profileGalleryBtn')?.addEventListener('click',()=>$('profileGalleryInput').click());$('profileCameraBtn')?.addEventListener('click',()=>$('profileCameraInput').click());$('profileGalleryInput')?.addEventListener('change',e=>{handleProfilePhoto(e.target.files?.[0]);e.target.value=''});$('profileCameraInput')?.addEventListener('change',e=>{handleProfilePhoto(e.target.files?.[0]);e.target.value=''});
  setupCropper();
}


