/* 부지 자동확인: V-World(지적·규제·인접 필지) + 표고(경사). 브라우저에서 직접 호출한다.
   원칙: 확인하지 못한 것은 '해당 없음'이 아니라 '확인 불가'로 표시한다. */
var BFGeo=(function(){
  var JIMOK={"전":"전","답":"답","과":"과수원","목":"목장용지","임":"임야","광":"광천지","염":"염전","대":"대지","장":"공장용지","학":"학교용지","차":"주차장","주":"주유소용지","창":"창고용지","도":"도로","철":"철도용지","제":"제방","천":"하천","구":"구거","유":"유지","양":"양어장","수":"수도용지","공":"공원","체":"체육용지","원":"유원지","종":"종교용지","사":"사적지","묘":"묘지","잡":"잡종지"};
  var GROUPS=[
    {id:"zone",label:"용도지역",kind:"info",layers:["LT_C_UQ111","LT_C_UQ112","LT_C_UQ113","LT_C_UQ114"]},
    {id:"agri",label:"농업진흥구역",kind:"reg",layers:["LT_C_AGRIXUE101","LT_C_AGRIXUE102"]},
    {id:"forest",label:"임상도(참고)",kind:"info",layers:["LT_C_FSDIFRSTS"]},
    {id:"gb",label:"개발제한구역",kind:"reg",layers:["LT_C_UD801"]}
  ];
  var seq=0;
  function ls(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
  function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  function getKey(){try{return localStorage.getItem("bf-vw-key")||""}catch(e){return ""}}
  function setKey(k){try{localStorage.setItem("bf-vw-key",k)}catch(e){}}
  function domain(){return location.hostname||"localhost"}

  function jsonp(url,params,timeout){
    return new Promise(function(res,rej){
      var n="__bfcb"+(++seq)+"_"+Date.now(),s=document.createElement("script");
      var to=setTimeout(function(){c();rej(new Error("응답 시간 초과"))},timeout||20000);
      function c(){clearTimeout(to);delete window[n];s.remove()}
      window[n]=function(d){c();res(d)};
      s.onerror=function(){c();rej(new Error("요청 실패: 인증키가 틀렸거나, 이 주소("+domain()+")가 V-World 키에 등록돼 있지 않을 수 있습니다"))};
      var p=Object.assign({},params,{callback:n});
      s.src=url+"?"+new URLSearchParams(p).toString();document.head.appendChild(s);
    });
  }
  async function vwData(layer,extra){
    var p=Object.assign({service:"data",request:"GetFeature",data:layer,version:"2.0",format:"json",errorformat:"json",crs:"EPSG:4326",size:"10",geometry:"true",attribute:"true",key:getKey(),domain:domain()},extra||{});
    var r=await jsonp("https://api.vworld.kr/req/data",p),R=(r&&r.response)||{};
    var st=R.status||"UNKNOWN",feats=[];
    if(st==="OK"&&R.result&&R.result.featureCollection)feats=R.result.featureCollection.features||[];
    return {status:st,features:feats,error:R.error?((R.error.code||"")+" "+(R.error.text||"")).trim():""};
  }

  /* ── 기하 ── */
  function polys(g){if(!g)return [];if(g.type==="Polygon")return [g.coordinates[0]];if(g.type==="MultiPolygon")return g.coordinates.map(function(p){return p[0]});return []}
  function mk(lon0,lat0){var kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;return function(r){return r.map(function(p){return [(p[0]-lon0)*kx,(p[1]-lat0)*ky]})}}
  function area(r){var a=0;for(var i=0;i<r.length;i++){var p=r[i],q=r[(i+1)%r.length];a+=p[0]*q[1]-q[0]*p[1]}return Math.abs(a)/2}
  function pip(pt,r){var x=pt[0],y=pt[1],ins=false;for(var i=0,j=r.length-1;i<r.length;j=i++){var xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins}return ins}
  function segX(a,b,c,d){function o(p,q,r){return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])}
    var d1=o(a,b,c),d2=o(a,b,d),d3=o(c,d,a),d4=o(c,d,b);return ((d1>0)!==(d2>0))&&((d3>0)!==(d4>0))}
  function overlap(A,B){
    for(var i=0;i<A.length;i++)if(pip(A[i],B))return true;
    for(var j=0;j<B.length;j++)if(pip(B[j],A))return true;
    for(var a=0;a<A.length;a++){var a2=A[(a+1)%A.length];for(var b=0;b<B.length;b++)if(segX(A[a],a2,B[b],B[(b+1)%B.length]))return true}
    return false;
  }
  function dPtSeg(p,a,b){var dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy,t=L?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L:0;t=Math.max(0,Math.min(1,t));var x=a[0]+t*dx,y=a[1]+t*dy;return Math.hypot(p[0]-x,p[1]-y)}
  function minDist(A,B){var m=1e18;
    for(var i=0;i<A.length;i++)for(var j=0;j<B.length;j++)m=Math.min(m,dPtSeg(A[i],B[j],B[(j+1)%B.length]));
    for(var k=0;k<B.length;k++)for(var l=0;l<A.length;l++)m=Math.min(m,dPtSeg(B[k],A[l],A[(l+1)%A.length]));
    return m}

  /* ── 필지번호 변환 (온비드는 대지구분 자리가 0으로 와서 V-World 값(1 일반 / 2 산)으로 바꿔야 조회된다) ── */
  function pnuVariants(pnu,name){
    pnu=String(pnu||"");if(pnu.length!==19)return [];
    if(pnu.slice(11,15)==="0000")return [];            // 번지 정보 없음(여러 필지 묶음 등)
    var d=pnu[10];if(d==="1"||d==="2")return [pnu];
    var san=/(^|\s)산\s*\d/.test(name||"");
    return (san?["2","1"]:["1","2"]).map(function(x){return pnu.slice(0,10)+x+pnu.slice(11)});
  }
  function jibunInfo(j){j=String(j||"");var ch=j.slice(-1);return /\d/.test(ch)?{code:"",name:""}:{code:ch,name:JIMOK[ch]||ch}}
  function propName(p){p=p||{};var ks=["uname","dgm_nm","name","nm","dname","prpos_area_dstrc_nm1"];for(var i=0;i<ks.length;i++)if(p[ks[i]])return String(p[ks[i]]);
    for(var k in p){if(/^(sido_name|sigg_name|sgg_name|emd_name|dyear|dnum)$/.test(k))continue;if(typeof p[k]==="string"&&p[k]&&!/^\d+$/.test(p[k]))return p[k]}return "(이름 없음)"}

  /* ── 경사: SRTM 30m 표고를 격자로 읽어 평면 근사 ── */
  function plane(pts){ // pts: [x,y,z] → 기울기(도)
    var n=pts.length,sx=0,sy=0,sz=0,sxx=0,sxy=0,syy=0,sxz=0,syz=0;
    pts.forEach(function(p){sx+=p[0];sy+=p[1];sz+=p[2];sxx+=p[0]*p[0];sxy+=p[0]*p[1];syy+=p[1]*p[1];sxz+=p[0]*p[2];syz+=p[1]*p[2]});
    var M=[[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],B=[sxz,syz,sz];
    function det(m){return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])}
    var D=det(M);if(Math.abs(D)<1e-9)return null;
    function rep(c){return M.map(function(r,i){var q=r.slice();q[c]=B[i];return q})}
    var a=det(rep(0))/D,b=det(rep(1))/D;return Math.atan(Math.hypot(a,b))*180/Math.PI;
  }
  async function slopeOf(ringLL,lon0,lat0){
    var to=mk(lon0,lat0),R=to(ringLL),ar=area(R),xs=R.map(function(p){return p[0]}),ys=R.map(function(p){return p[1]});
    var x0=Math.min.apply(0,xs),x1=Math.max.apply(0,xs),y0=Math.min.apply(0,ys),y1=Math.max.apply(0,ys);
    var step=Math.max(30,Math.sqrt(ar/36)),pts=[];
    for(var x=x0+step/2;x<x1;x+=step)for(var y=y0+step/2;y<y1;y+=step)if(pip([x,y],R))pts.push([x,y]);
    if(pts.length<4){ // 작은 필지: 꼭짓점+중심
      pts=R.slice(0,Math.min(R.length,8)).concat([[ (x0+x1)/2,(y0+y1)/2 ]]);
    }
    pts=pts.slice(0,60);
    var kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;
    var lats=pts.map(function(p){return +(lat0+p[1]/ky).toFixed(6)}),lons=pts.map(function(p){return +(lon0+p[0]/kx).toFixed(6)});
    var z=[],src="",errs=[];
    async function viaTopo(){
      var loc=lats.map(function(la,i){return la+","+lons[i]}).join("|");
      var rs=await fetch("https://api.opentopodata.org/v1/srtm30m?interpolation=bilinear&locations="+loc);
      if(!rs.ok)throw new Error("opentopodata HTTP "+rs.status);
      var j=await rs.json();if(j.status!=="OK"||!j.results)throw new Error("opentopodata 응답 이상");
      return j.results.map(function(r){return r.elevation});
    }
    async function viaMeteo(){
      var rs=await fetch("https://api.open-meteo.com/v1/elevation?latitude="+lats.join(",")+"&longitude="+lons.join(","));
      if(!rs.ok)throw new Error("open-meteo HTTP "+rs.status);
      var j=await rs.json();if(!j.elevation)throw new Error("open-meteo 응답 이상");
      return j.elevation;
    }
    var tries=[["SRTM 30m",viaTopo],["Copernicus 90m",viaMeteo]];
    for(var t=0;t<tries.length&&!z.length;t++){
      try{var el=await tries[t][1]();var tmp=[];el.forEach(function(v,i){if(v!==null&&v!==undefined&&isFinite(v))tmp.push([pts[i][0],pts[i][1],v])});
        if(tmp.length>=4){z=tmp;src=tries[t][0]}else errs.push(tries[t][0]+": 표고 값 부족")}
      catch(e){errs.push(tries[t][0]+": "+(e.message==="Failed to fetch"?"접속 실패(차단 또는 네트워크)":e.message))}
    }
    if(!z.length)throw new Error(errs.join(" / "));
    var zs=z.map(function(p){return p[2]});
    return {deg:plane(z),relief:Math.max.apply(0,zs)-Math.min.apply(0,zs),n:z.length,src:src};
  }

  /* ── 필지 하나 점검 ── */
  async function check(item,opt){
    opt=opt||{};
    var out={ts:Date.now(),notes:[],layers:{},road:null,slope:null,parcel:null};
    if(!getKey()){out.error="V-World 인증키를 먼저 입력하세요.";return out}
    var vs=pnuVariants(item.pnu,item.name);
    if(!vs.length){out.error="필지번호에 번지 정보가 없습니다(여러 필지 묶음이거나 번지 없음). 자동확인 불가.";return out}
    var f=null,used="";
    for(var i=0;i<vs.length&&!f;i++){
      var r=await vwData("LP_PA_CBND_BUBUN",{attrFilter:"pnu:=:"+vs[i],size:"1"});
      if(r.status==="OK"&&r.features.length){f=r.features[0];used=vs[i]}
      else if(r.status!=="NOT_FOUND")throw new Error("지적도 조회 오류: "+r.status+" "+r.error);
    }
    if(!f){out.error="지적도에서 이 필지번호를 찾지 못했습니다.";return out}
    var ps=polys(f.geometry);if(!ps.length){out.error="필지 경계 형식을 읽지 못했습니다.";return out}
    var ring=ps.reduce(function(a,b){return b.length>a.length?b:a});
    var lon0=ring[0][0],lat0=ring[0][1],to=mk(lon0,lat0),P=to(ring);
    var ji=jibunInfo(f.properties&&f.properties.jibun);
    var lons=ring.map(function(p){return p[0]}),lats=ring.map(function(p){return p[1]});
    var bb={x0:Math.min.apply(0,lons),x1:Math.max.apply(0,lons),y0:Math.min.apply(0,lats),y1:Math.max.apply(0,lats)};
    var rr=ring.length>60?ring.filter(function(_,i){return i%Math.ceil(ring.length/60)===0}):ring;
    out.parcel={ring:rr.map(function(p){return [+p[1].toFixed(6),+p[0].toFixed(6)]}),center:[+((bb.y0+bb.y1)/2).toFixed(6),+((bb.x0+bb.x1)/2).toFixed(6)],pnu:used,addr:(f.properties||{}).addr||"",jibun:(f.properties||{}).jibun||"",jimok:ji.name,jimokCode:ji.code,areaGeo:Math.round(area(P)),polys:ps.length};
    var box=function(d){return "BOX("+(bb.x0-d)+","+(bb.y0-d)+","+(bb.x1+d)+","+(bb.y1+d)+")"};

    /* 규제·용도 레이어 */
    var okL=ls("bf-vw-ok",{});
    for(var g=0;g<GROUPS.length;g++){
      var G=GROUPS[g];if(opt.groups&&opt.groups.indexOf(G.id)<0)continue;
      var res={label:G.label,kind:G.kind,status:"none",names:[],detail:[]};
      var anyVerified=false,anyErr="";
      for(var l=0;l<G.layers.length;l++){
        var L=G.layers[l];
        try{
          var q=await vwData(L,{geomFilter:box(0),size:"15"});
          if(q.status==="OK"){okL[L]=true;anyVerified=true;
            q.features.forEach(function(ft){
              var hit=polys(ft.geometry).some(function(pg){return overlap(P,to(pg))});
              if(hit){var nm=propName(ft.properties);if(nm!=="(이름 없음)")res.names.push(nm)}});
          }else if(q.status==="NOT_FOUND"){
            anyVerified=true; // 잘못된 레이어 이름은 INVALID_RANGE 오류로 구분됨(2026-10-27 실측) → NOT_FOUND는 이름이 유효하고 해당 위치에 자료가 없다는 뜻
          }else{anyErr=q.status+" "+q.error}
        }catch(e){anyErr=e.message}
      }
      lsSet("bf-vw-ok",okL);
      if(res.names.length){res.status="overlap";res.names=Array.from(new Set(res.names))}
      else if(anyVerified)res.status="none";
      else res.status=anyErr?"error":"unverified";
      if(anyErr)res.detail.push(anyErr);
      out.layers[G.id]=res;
    }

    /* 인접 필지 → 도로 접함 */
    if(opt.road!==false)try{
      var nb=await vwData("LP_PA_CBND_BUBUN",{geomFilter:box(0.0003),size:"60"});
      if(nb.status==="OK"){
        var roadTouch=[],others=[];
        nb.features.forEach(function(ft){
          if(ft.properties&&ft.properties.pnu===used)return;
          var nj=jibunInfo(ft.properties&&ft.properties.jibun);
          var d=Math.min.apply(0,polys(ft.geometry).map(function(pg){return minDist(P,to(pg))}));
          if(d<=2){if(nj.code==="도")roadTouch.push(ft.properties.jibun);else if(nj.code==="구"||nj.code==="천"||nj.code==="제"||nj.code==="철")others.push(nj.name+" "+ft.properties.jibun)}
        });
        out.road={status:roadTouch.length?"touch":"no",roads:roadTouch.slice(0,4),others:others.slice(0,4),truncated:nb.features.length>=60};
      }else out.road={status:"error",detail:nb.status+" "+nb.error};
    }catch(e){out.road={status:"error",detail:e.message}}

    /* 경사 */
    if(opt.slope!==false){
      try{out.slope=Object.assign({status:"ok"},await slopeOf(ring,lon0,lat0))}
      catch(e){out.slope={status:"error",detail:e.message}}
    }
    return out;
  }

  /* ── 요약 판정 ── */
  function summarize(r,item,slopeLimit){
    var flags=[],warns=[],unk=[],info=[];
    if(r.error)return {level:"미검토",flags:[],warns:[],unk:[r.error],info:[]};
    var P=r.parcel;
    if(item.land_category&&P.jimok&&P.jimok!==item.land_category)warns.push("지목 불일치: 지적도 "+P.jimok+" / 온비드 분류 "+item.land_category);
    var ag=r.layers.agri;if(ag){if(ag.status==="overlap")flags.push("농업진흥구역 해당("+ag.names.join(", ")+")");else if(ag.status!=="none")unk.push("농업진흥구역 확인 불가")}
    var gbL=r.layers.gb;if(gbL){if(gbL.status==="overlap")flags.push("개발제한구역 해당("+gbL.names.join(", ")+")");else if(gbL.status!=="none")info.push("개발제한구역 확인 불가(레이어 미검증, 등급은 잠정)")}
    var z=r.layers.zone;if(z&&z.status==="overlap")info.push("용도지역: "+z.names.join(", "));else if(z&&z.status!=="none")unk.push("용도지역 확인 불가");
    if(r.road){if(r.road.status==="no")flags.push("도로 지목 필지와 접하지 않음(맹지 여부는 현황도로·사도 확인 필요)");else if(r.road.status==="error")unk.push("진입 확인 불가")}
    if(r.slope){if(r.slope.status==="ok"&&r.slope.deg!==null){if(r.slope.deg>slopeLimit)flags.push("평균 경사 약 "+r.slope.deg.toFixed(1)+"° (기준 "+slopeLimit+"° 초과)")}else unk.push("경사 확인 불가")}
    var level=flags.length?"문제":(warns.length||unk.length)?"주의":"양호";
    return {level:level,flags:flags,warns:warns,unk:unk,info:info};
  }
  return {version:"2026-10-28-n (검토)",check:check,summarize:summarize,getKey:getKey,setKey:setKey,domain:domain,pnuVariants:pnuVariants,jibunInfo:jibunInfo,ls:ls,lsSet:lsSet};
})();
