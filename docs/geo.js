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
  function getKey(){var k="";try{k=localStorage.getItem("bf-vw-key")||""}catch(e){}return k||window.BF_VW_KEY||""}
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

  /* ── 토지이용계획(NED, 필지번호 기준) ── */
  var ZONES=["제1종전용주거지역","제2종전용주거지역","제1종일반주거지역","제2종일반주거지역","제3종일반주거지역","준주거지역","중심상업지역","일반상업지역","근린상업지역","유통상업지역","전용공업지역","일반공업지역","준공업지역","보전녹지지역","생산녹지지역","자연녹지지역","보전관리지역","생산관리지역","계획관리지역","농림지역","자연환경보전지역","관리지역","도시지역"];
  async function nedQuery(pnu){
    var p={key:getKey(),domain:domain(),pnu:pnu,format:"json",numOfRows:"200",pageNo:"1"},u="https://api.vworld.kr/ned/data/getLandUseAttr",r=null;
    try{var rs=await fetch(u+"?"+new URLSearchParams(p).toString());r=await rs.json()}catch(e){}
    if(!r)r=await jsonp(u,p);
    var f=r&&r.landUses&&r.landUses.field;
    if(f===undefined||f===null){if(r&&r.landUses&&String(r.landUses.totalCount)==="0")return [];throw new Error("토지이용계획 응답 형식 이상: "+JSON.stringify(r).slice(0,120))}
    if(!Array.isArray(f))f=[f];
    var seen={},out=[];
    f.forEach(function(x){var n=x.prposAreaDstrcCodeNm||"",c=String(x.cnflcAt||"");if(!n)return;var k=n+"|"+c;if(seen[k])return;seen[k]=1;out.push([n,c])});
    return out;
  }
  async function landChar(pnu){ // 토지특성(도로접면·지형높이·지형형상·이용상황). 응답 키 이름이 달라도 찾도록 느슨하게 처리
    var p={key:getKey(),domain:domain(),pnu:pnu,format:"json",numOfRows:"10",pageNo:"1"},u="https://api.vworld.kr/ned/data/getLandCharacteristics",r=null;
    try{r=await (await fetch(u+"?"+new URLSearchParams(p).toString())).json()}catch(e){}
    if(!r)try{r=await jsonp(u,p)}catch(e){}
    window.BF_LC_LAST=r;
    var arr=null;(function find(o){if(arr||!o||typeof o!=="object")return;if(o.field){arr=Array.isArray(o.field)?o.field:[o.field];return}Object.keys(o).forEach(function(k){find(o[k])})})(r);
    if(!arr||!arr.length)return null;
    arr.sort(function(a,b){return (+b.stdrYear||0)-(+a.stdrYear||0)});var x=arr[0];
    function pick(rx){var k=Object.keys(x).find(function(k){return rx.test(k)&&x[k]});return k?String(x[k]):""}
    return {year:x.stdrYear||"",road:pick(/roadSide.*Nm|road.*Nm/i),height:pick(/tpgrphHg.*Nm|Hg.*Nm/i),shape:pick(/tpgrphFrm.*Nm|Frm.*Nm/i),use:pick(/ladUse.*Nm|UseSittn.*Nm/i),raw:x};
  }
  async function searchAddr(q,size){ // 지번 주소 후보(V-World 검색 API). [{addr,pnu,pt:[lon,lat]}]
    var p={service:"search",request:"search",version:"2.0",crs:"EPSG:4326",query:q,type:"address",category:"parcel",format:"json",errorformat:"json",size:String(size||10),page:"1",key:getKey(),domain:domain()},u="https://api.vworld.kr/req/search",r=null;
    try{r=await jsonp(u,p,10000)}catch(e){try{r=await (await fetch(u+"?"+new URLSearchParams(p).toString())).json()}catch(e2){throw e}}
    var R=(r&&r.response)||{};if(R.status!=="OK"||!R.result)return [];
    return (R.result.items||[]).map(function(x){return {addr:(x.address&&x.address.parcel)||x.title||"",pnu:x.id||"",pt:x.point?[+x.point.x,+x.point.y]:null}}).filter(function(x){return x.addr});
  }
  async function landPrice(pnu){ // 개별공시지가(원/㎡) 최근 연도. 응답 형식은 NED 공통 형식으로 가정
    var p={key:getKey(),domain:domain(),pnu:pnu,format:"json",numOfRows:"10",pageNo:"1"},u="https://api.vworld.kr/ned/data/getIndvdLandPriceAttr",r=null;
    try{r=await (await fetch(u+"?"+new URLSearchParams(p).toString())).json()}catch(e){}
    if(!r)r=await jsonp(u,p);
    var f=r&&r.indvdLandPrices&&r.indvdLandPrices.field;if(!f)return null;if(!Array.isArray(f))f=[f];
    var best=null;f.forEach(function(x){var y=+x.stdrYear,v=+String(x.pblntfPclnd||"").replace(/,/g,"");if(v>0&&(!best||y>best.year))best={year:y,won:v}});
    return best;
  }
  // 코드: 1·2는 레이어 대조에서 거의 전부 겹침이 확인됨(2026-10-28 전수 3,353필지). 3은 의미 미확정 → '경계 걸침'으로 따로 취급
  function nedGroup(list,test,label,kind){
    var hit=list.filter(function(x){return test(x[0])});
    var core=hit.filter(function(x){return x[1]!=="3"}),edge=hit.filter(function(x){return x[1]==="3"});
    var uniq=function(a){return Array.from(new Set(a.map(function(x){return x[0]})))};
    if(core.length)return {label:label,kind:kind,status:"overlap",names:uniq(core),edge:uniq(edge).filter(function(n){return uniq(core).indexOf(n)<0}),detail:[],src:"NED"};
    if(edge.length)return {label:label,kind:kind,status:"edge",names:uniq(edge),edge:uniq(edge),detail:[],src:"NED"};
    return {label:label,kind:kind,status:"none",names:[],edge:[],detail:[],src:"NED"};
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
  function isSan(name){return /(^|[\s,])산\s*\d/.test(name||"")}
  function pnuVariants(pnu,name){
    pnu=String(pnu||"");if(pnu.length!==19)return [];
    if(pnu.slice(11,15)==="0000")return [];            // 번지 정보 없음(여러 필지 묶음 등)
    // 온비드 PNU는 산 번지도 11번째 자리를 1(일반)로 주는 경우가 대부분(2026-10-28 전수 확인: 산 428건 중 427건).
    // 같은 번호의 일반 번지 필지를 잘못 잡지 않도록 이름의 '산' 여부로 자리를 정한다.
    var san=isSan(name),d=pnu[10];
    if(san)return [pnu.slice(0,10)+"2"+pnu.slice(11)];
    if(d==="1"||d==="2")return [pnu];
    return ["1","2"].map(function(x){return pnu.slice(0,10)+x+pnu.slice(11)});
  }
  function stale(r,item){ // 예전 코드로 산 번지를 일반 번지로 잘못 조회한 저장 결과
    if(!r||!r.parcel)return false;var j=String(r.parcel.jibun||"");
    return isSan(item&&item.name)!==/^산/.test(j);
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
    var a=det(rep(0))/D,b=det(rep(1))/D;plane.last=[a,b];return Math.atan(Math.hypot(a,b))*180/Math.PI;
  }
  async function slopeOf(ringLL,lon0,lat0){
    // 필지를 감싸는 격자(최대 100점)의 표고를 받아 ① 전체 기울기(plane) ② 칸별 경사 → 평균경사도·급경사 구역 계산
    var to=mk(lon0,lat0),R=to(ringLL),ar=area(R),xs=R.map(function(p){return p[0]}),ys=R.map(function(p){return p[1]});
    var x0=Math.min.apply(0,xs),x1=Math.max.apply(0,xs),y0=Math.min.apply(0,ys),y1=Math.max.apply(0,ys);
    var step=Math.max(30,Math.sqrt((x1-x0+60)*(y1-y0+60)/100));
    var nx=Math.max(2,Math.ceil((x1-x0)/step)+2),ny=Math.max(2,Math.ceil((y1-y0)/step)+2);
    while(nx*ny>100){step*=1.08;nx=Math.max(2,Math.ceil((x1-x0)/step)+2);ny=Math.max(2,Math.ceil((y1-y0)/step)+2)}
    var gx0=(x0+x1)/2-(nx-1)*step/2,gy0=(y0+y1)/2-(ny-1)*step/2,pts=[];
    for(var j=0;j<ny;j++)for(var i=0;i<nx;i++)pts.push([gx0+i*step,gy0+j*step]);
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
    var tries=[["SRTM 30m",viaTopo],["Copernicus 90m",viaMeteo]],EL=null;
    for(var t=0;t<tries.length&&!EL;t++){
      try{var el=await tries[t][1]();var ok=el.filter(function(v){return v!==null&&v!==undefined&&isFinite(v)}).length;
        if(ok>=4){EL=el;src=tries[t][0]}else errs.push(tries[t][0]+": 표고 값 부족")}
      catch(e){errs.push(tries[t][0]+": "+(e.message==="Failed to fetch"?"접속 실패(차단 또는 네트워크)":e.message))}
    }
    if(!EL)throw new Error(errs.join(" / "));
    function Z(i,j){if(i<0||j<0||i>=nx||j>=ny)return null;var v=EL[j*nx+i];return (v===null||v===undefined||!isFinite(v))?null:v}
    var inside=[],cells=[];
    for(var j2=0;j2<ny;j2++)for(var i2=0;i2<nx;i2++){var p=pts[j2*nx+i2],zz=Z(i2,j2);if(zz===null||!pip(p,R))continue;inside.push([p[0],p[1],zz]);
      var zl=Z(i2-1,j2),zr=Z(i2+1,j2),zd=Z(i2,j2-1),zu=Z(i2,j2+1);
      var gx=zl!==null&&zr!==null?(zr-zl)/(2*step):zr!==null?(zr-zz)/step:zl!==null?(zz-zl)/step:null;
      var gy=zd!==null&&zu!==null?(zu-zd)/(2*step):zu!==null?(zu-zz)/step:zd!==null?(zz-zd)/step:null;
      if(gx!==null&&gy!==null)cells.push([lons[j2*nx+i2],lats[j2*nx+i2],Math.atan(Math.hypot(gx,gy))*180/Math.PI])}
    // 필지 안 격자점이 너무 적으면(작은 필지) 주변 격자 전체로 기울기만 계산
    var zsrc=inside.length>=4?inside:pts.map(function(p,k){return [p[0],p[1],EL[k]]}).filter(function(p){return p[2]!==null&&p[2]!==undefined&&isFinite(p[2])});
    var zs=zsrc.map(function(p){return p[2]});
    var mean=cells.length>=4?cells.reduce(function(a,c){return a+c[2]},0)/cells.length:null;
    var pd=plane(zsrc),ab=plane.last||[0,0];
    // 경사 방향: dzdy>0 이면 북쪽으로 올라가는 땅(남향 사면), aspect = 내려가는 방향(북=0°, 동=90°)
    var asp=(Math.atan2(-ab[0],-ab[1])*180/Math.PI+360)%360;
    return {deg:pd,dzdx:ab[0],dzdy:ab[1],aspect:asp,meanDeg:mean,cells:cells.length>=4?cells:[],step:step,relief:Math.max.apply(0,zs)-Math.min.apply(0,zs),n:zsrc.length,src:src};
  }

  /* ── 대표지번 찾기: 필지번호가 없거나 번지가 0000인 물건 ── */
  function parseJibun(name){ // 물건명에서 '…리/동/가 (산)본번-부번' 첫 번째를 대표지번으로
    var m=String(name||"").match(/(?:^|\s)([가-힣]+(?:\d+가|동|리|가))\s*(산\s*)?(\d{1,4})(?:-(\d{1,4}))?(?=$|[\s,()외번])/);
    if(!m)return null;
    return {emd:m[1],san:!!m[2],bon:+m[3],bu:m[4]?+m[4]:0,text:m[1]+" "+(m[2]?"산":"")+m[3]+(m[4]?"-"+m[4]:"")};
  }
  function parseRoad(name){var m=String(name||"").match(/^(.*?[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)(?=$|[\s,(])/);return m?m[1]:null}
  function multiCount(name){var m=String(name||"").match(/외\s*(\d+)\s*(?:개\s*)?필지/);if(m)return +m[1];return /외(?=\s|$)|일괄/.test(String(name||""))?-1:0}
  function pad4(n){return ("0000"+n).slice(-4)}
  async function geocode(addr,type){
    var p={service:"address",request:"getcoord",version:"2.0",crs:"epsg:4326",address:addr,refine:"true",simple:"false",format:"json",type:type,key:getKey(),domain:domain()},u="https://api.vworld.kr/req/address",r=null;
    try{r=await jsonp(u,p,15000)}catch(e){try{r=await (await fetch(u+"?"+new URLSearchParams(p).toString())).json()}catch(e2){throw e}}
    var R=(r&&r.response)||{};if(R.status!=="OK"||!R.result||!R.result.point)return null;
    return [+R.result.point.x,+R.result.point.y];
  }
  async function findParcel(addr){ // 주소(지번 또는 도로명) → 필지 {pnu, addr, jibun}
    addr=String(addr||"").replace(/\s+/g," ").trim();if(!addr)throw new Error("주소를 입력하세요");
    var pt=null;try{pt=await geocode(addr,"PARCEL")}catch(e){}
    if(!pt){try{pt=await geocode(addr,"ROAD")}catch(e){}}
    if(!pt)return null;
    var q=await vwData("LP_PA_CBND_BUBUN",{geomFilter:"POINT("+pt[0]+" "+pt[1]+")",size:"1",geometry:"false"});
    if(q.status!=="OK"||!q.features.length)return null;
    var pr=q.features[0].properties||{};
    return {pnu:String(pr.pnu),addr:String(pr.addr||addr),jibun:String(pr.jibun||""),point:pt};
  }
  async function parcelAt(lon,lat){ // 지도에서 누른 위치의 필지 {pnu, addr, jibun, point, ring:[[lat,lon]...]}
    var q=await vwData("LP_PA_CBND_BUBUN",{geomFilter:"POINT("+lon+" "+lat+")",size:"1"});
    if(q.status!=="OK"||!q.features.length)return null;
    var f=q.features[0],pr=f.properties||{},ps=polys(f.geometry),ring=ps.length?ps.reduce(function(a,b){return b.length>a.length?b:a}):[];
    return {pnu:String(pr.pnu),addr:String(pr.addr||""),jibun:String(pr.jibun||""),point:[lon,lat],ring:ring.map(function(p){return [p[1],p[0]]})};
  }
  async function resolveParcel(item){ // → {pnus:[...], method, rep}
    var name=item.name||"",rep={multi:multiCount(name)};
    var vs=pnuVariants(item.pnu,name);
    if(vs.length){rep.method="필지번호";return {pnus:vs,rep:rep}}
    var J=parseJibun(name);
    var p10=String(item.pnu||"").length===19?String(item.pnu).slice(0,10):"";
    if(J&&p10&&p10!=="0000000000"){rep.method="물건명 대표지번("+J.text+")";rep.emd=J.emd;
      return {pnus:[p10+(J.san?"2":"1")+pad4(J.bon)+pad4(J.bu)],rep:rep}}
    // 주소 좌표 검색 → 그 자리의 필지
    var addr=null,type=null;
    if(J){var pre=name.slice(0,name.indexOf(J.emd)+J.emd.length);addr=pre+" "+(J.san?"산":"")+J.bon+(J.bu?"-"+J.bu:"");type="PARCEL";rep.emd=J.emd}
    else{var rd=parseRoad(name);if(rd){addr=rd;type="ROAD"}}
    if(!addr){rep.method="불가";rep.why="물건명에서 지번이나 도로명 주소를 찾지 못했습니다";return {pnus:[],rep:rep}}
    var pt=null;try{pt=await geocode(addr,type)}catch(e){rep.method="불가";rep.why="주소 좌표 검색 실패: "+e.message;return {pnus:[],rep:rep}}
    if(!pt){rep.method="불가";rep.why="주소 좌표 검색 결과 없음("+addr+")";return {pnus:[],rep:rep}}
    var q=await vwData("LP_PA_CBND_BUBUN",{geomFilter:"POINT("+pt[0]+" "+pt[1]+")",size:"1",geometry:"false"});
    if(q.status!=="OK"||!q.features.length){rep.method="불가";rep.why="좌표 위치의 필지를 찾지 못했습니다";return {pnus:[],rep:rep}}
    rep.method="주소 좌표 검색("+addr+")";
    return {pnus:[String(q.features[0].properties.pnu)],rep:rep};
  }

  /* ── 필지 하나 점검 ── */
  async function check(item,opt){
    opt=opt||{};
    var out={ts:Date.now(),notes:[],layers:{},road:null,slope:null,parcel:null};
    if(!getKey()){out.error="V-World 인증키를 먼저 입력하세요.";return out}
    var RP=await resolveParcel(item),vs=RP.pnus;out.rep=RP.rep;
    if(!vs.length){out.error="대표 필지를 정하지 못했습니다: "+(RP.rep.why||"필지번호·지번 정보 없음");return out}
    var f=null,used="";
    for(var i=0;i<vs.length&&!f;i++){
      var r=await vwData("LP_PA_CBND_BUBUN",{attrFilter:"pnu:=:"+vs[i],size:"1"});
      if(r.status==="OK"&&r.features.length){f=r.features[0];used=vs[i]}
      else if(r.status!=="NOT_FOUND")throw new Error("지적도 조회 오류: "+r.status+" "+r.error);
    }
    if(!f){out.error="지적도에서 이 필지번호를 찾지 못했습니다."+(isSan(item.name)?" (산 번지로 조회)":"");return out}
    if(out.rep.emd&&String((f.properties||{}).addr||"").indexOf(out.rep.emd)<0){out.error="찾은 필지의 주소("+((f.properties||{}).addr||"")+")에 물건명의 "+out.rep.emd+"이(가) 없어 검토하지 않았습니다.";return out}
    if(out.rep.method==="필지번호"&&isSan(item.name)!==/^산/.test(String((f.properties||{}).jibun||""))){out.error="필지번호와 물건명의 산 번지 여부가 맞지 않아 검토하지 않았습니다(지적도: "+((f.properties||{}).jibun||"")+").";return out}
    var ps=polys(f.geometry);if(!ps.length){out.error="필지 경계 형식을 읽지 못했습니다.";return out}
    var ring=ps.reduce(function(a,b){return b.length>a.length?b:a});
    var lon0=ring[0][0],lat0=ring[0][1],to=mk(lon0,lat0),P=to(ring);
    var ji=jibunInfo(f.properties&&f.properties.jibun);
    var lons=ring.map(function(p){return p[0]}),lats=ring.map(function(p){return p[1]});
    var bb={x0:Math.min.apply(0,lons),x1:Math.max.apply(0,lons),y0:Math.min.apply(0,lats),y1:Math.max.apply(0,lats)};
    var rr=ring.length>60?ring.filter(function(_,i){return i%Math.ceil(ring.length/60)===0}):ring;
    out.parcel={ring:rr.map(function(p){return [+p[1].toFixed(6),+p[0].toFixed(6)]}),center:[+((bb.y0+bb.y1)/2).toFixed(6),+((bb.x0+bb.x1)/2).toFixed(6)],pnu:used,addr:(f.properties||{}).addr||"",jibun:(f.properties||{}).jibun||"",jimok:ji.name,jimokCode:ji.code,areaGeo:Math.round(area(P)),polys:ps.length};
    var box=function(d){return "BOX("+(bb.x0-d)+","+(bb.y0-d)+","+(bb.x1+d)+","+(bb.y1+d)+")"};

    /* 토지이용계획(NED) 우선 */
    var nedDone={};
    if(opt.source!=="layer"){
      try{
        var NL=await nedQuery(used);out.ned=NL;out.src="NED";
        out.layers.zone=nedGroup(NL,function(n){return ZONES.indexOf(n)>=0&&n!=="도시지역"&&n!=="관리지역"},"용도지역","info");
        out.layers.gb=nedGroup(NL,function(n){return /개발제한구역/.test(n)},"개발제한구역","reg");
        out.layers.agri=nedGroup(NL,function(n){return /농업진흥구역|농업보호구역/.test(n)},"농업진흥구역","reg");
        out.layers.sanji=nedGroup(NL,function(n){return /임업용산지|공익용산지/.test(n)||(/보전산지/.test(n)&&!/준보전산지/.test(n))},"보전산지","reg");
        nedDone={zone:1,gb:1,agri:1};
      }catch(e){out.notes.push("토지이용계획(NED) 조회 실패 → 지도 레이어로 대체: "+e.message)}
    }
    /* 규제·용도 레이어 (NED 실패 시 대체, 임상도는 항상) */
    var okL=ls("bf-vw-ok",{});
    for(var g=0;g<GROUPS.length;g++){
      var G=GROUPS[g];if(opt.groups&&opt.groups.indexOf(G.id)<0)continue;if(nedDone[G.id])continue;
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
        var roadTouch=[],others=[];out.parcel.nb=[];
        nb.features.forEach(function(ft){
          if(ft.properties&&ft.properties.pnu===used)return;
          var nj=jibunInfo(ft.properties&&ft.properties.jibun);
          polys(ft.geometry).forEach(function(pg){var st=Math.max(1,Math.ceil(pg.length/30));out.parcel.nb.push({c:nj.code,r:pg.filter(function(_,i){return i%st===0}).map(function(q){return [+q[1].toFixed(6),+q[0].toFixed(6)]})})});
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
    var ag=r.layers.agri;if(ag){var agReg=(ag.names||[]).filter(function(n){return !/영농여건불리/.test(n)}),agFav=(ag.names||[]).filter(function(n){return /영농여건불리/.test(n)});if(ag.status==="overlap"&&agReg.length)flags.push("농업진흥구역 해당("+agReg.join(", ")+")");else if(ag.status==="edge")warns.push("농업진흥·보호구역 경계 걸침("+ag.names.join(", ")+") — 토지이음으로 확인 필요");else if(ag.status!=="none"&&ag.status!=="overlap")unk.push("농업진흥구역 확인 불가");if(agFav.length)info.push("영농여건불리농지 해당(규제 아님)")}
    var gbL=r.layers.gb;if(gbL){if(gbL.status==="overlap")flags.push("개발제한구역 해당("+gbL.names.join(", ")+")");else if(gbL.status==="edge")warns.push("개발제한구역 경계 걸침 — 토지이음으로 확인 필요");else if(gbL.status!=="none")unk.push("개발제한구역 확인 불가")}
    var sj=r.layers.sanji;if(sj){if(sj.status==="overlap")flags.push("보전산지 해당("+sj.names.join(", ")+") — 태양광 설치 불가(준보전산지만 가능)");else if(sj.status==="edge")warns.push("보전산지 경계 걸침("+sj.names.join(", ")+") — 토지이음으로 확인 필요")}else if(r.src!=="NED")unk.push("보전산지 확인 불가(토지이용계획 조회 실패)");
    var z=r.layers.zone;if(z&&(z.status==="overlap"||z.status==="edge"))info.push("용도지역: "+z.names.join(", ")+((z.edge&&z.edge.length&&z.status==="overlap")?" (경계 걸침: "+z.edge.join(", ")+")":""));else if(z&&z.status!=="none")unk.push("용도지역 확인 불가");
    if(r.ned){var ex=r.ned.filter(function(x){return ZONES.indexOf(x[0])<0&&!/개발제한구역|농업진흥구역|농업보호구역|임업용산지|공익용산지/.test(x[0])&&!(/보전산지/.test(x[0])&&!/준보전산지/.test(x[0]))}).map(function(x){return x[0]+(x[1]==="3"?"(경계)":"")});if(ex.length)info.push("기타 토지이용계획: "+Array.from(new Set(ex)).join(", "))}
    if(r.road){if(r.road.status==="no")flags.push("도로 지목 필지와 접하지 않음(맹지 여부는 현황도로·사도 확인 필요)");else if(r.road.status==="error")unk.push("진입 확인 불가")}
    if(r.slope){if(r.slope.status==="ok"&&r.slope.deg!==null){if(r.slope.deg>slopeLimit)flags.push("평균 경사 약 "+r.slope.deg.toFixed(1)+"° (기준 "+slopeLimit+"° 초과)")}else unk.push("경사 확인 불가")}
    var level=flags.length?"문제":(warns.length||unk.length)?"주의":"양호";
    return {level:level,flags:flags,warns:warns,unk:unk,info:info};
  }
  return {version:"2026-10-30 (검토)",slopeOf:slopeOf,check:check,summarize:summarize,getKey:getKey,setKey:setKey,domain:domain,pnuVariants:pnuVariants,landChar:landChar,searchAddr:searchAddr,parcelAt:parcelAt,landPrice:landPrice,findParcel:findParcel,parseJibun:parseJibun,parseRoad:parseRoad,multiCount:multiCount,nedQuery:nedQuery,stale:stale,isSan:isSan,jibunInfo:jibunInfo,ls:ls,lsSet:lsSet};
})();
