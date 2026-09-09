/* 미래 공동체: 합성 자료와 검증 전 인과 가설. 실측·예측 모델이 아님. */
(function(root){
'use strict';
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const names=['물결 도시','숲길 도시','들녘 도시','해솔 도시','서버시티'];
const positions=[[160,170],[530,130],[150,410],[550,405],[355,285]];
const defaults={cooperation:65,trade:65,clean:65,travel:35,ai:65,remote:55,platform:30,youth:65,education:65,hubBudget:35};
const scenarios={
 metro:{name:'대도시 집중',inputs:{...defaults,cooperation:70,trade:75,clean:45,travel:35,ai:75,remote:25,platform:40,youth:40,education:75,hubBudget:75}},
 network:{name:'강소도시–서버시티 연결',inputs:{...defaults}},
 platform:{name:'플랫폼 종속',inputs:{...defaults,cooperation:80,trade:85,clean:55,travel:30,ai:90,remote:85,platform:90,youth:25,education:60,hubBudget:45}},
 fragmented:{name:'세계 분절',inputs:{...defaults,cooperation:15,trade:20,clean:40,travel:80,ai:40,remote:30,platform:45,youth:45,education:45,hubBudget:45}}
};
const fields=[['세계 경영',[['cooperation','국경 간 협력'],['trade','교역 접근']],'협력·교역 → 도시의 기회·서비스 접근'],['지속가능성',[['clean','청정에너지 비중'],['travel','이동 에너지 부담']],'이동비 → 방문 감소·현장노동 부담 / 청정에너지 → 에너지부담 완화'],['디지털 전환과 사회 변혁',[['ai','AI 접근'],['remote','원격근무 가능'],['platform','플랫폼 수익 집중']],'AI·원격 접근 → 기회 / 수익 집중 → 지역 기회 유출'],['다음세대 시대가치',[['youth','청년 의사결정 참여'],['education','교육/탐색 접근']],'참여·탐색 → 청년 선택 여건 (도덕성 평가 아님)']];
function normalize(input){const p={...defaults,...input};Object.keys(defaults).forEach(k=>{if(!Number.isFinite(p[k]))throw Error('유효하지 않은 입력: '+k);p[k]=clamp(p[k]);});return p;}
function snapshot(pop,p,year){
 const cities=pop.map((population,i)=>{
  const hub=i===4, budget=hub?p.hubBudget:(100-p.hubBudget)/4;
  const pressure=clamp(20+42*(population/40000-1));
  const visits=clamp((24+.30*p.cooperation+.15*p.trade)*(1-.007*p.travel)*(hub?1.12:1));
  const opportunity=clamp(18+.18*p.ai+.10*p.trade+.09*p.cooperation+.10*p.education+.11*p.remote*(hub?.35:1)-.15*p.platform*(hub?.35:1)+.38*budget+(hub?8:0)-.19*pressure+(i-2)*.8);
  const service=clamp(22+.32*budget+.20*p.education+.13*p.ai+.14*visits-.16*pressure+(hub?13:0));
  const mobility=clamp(9+.48*p.travel+.10*pressure+(hub?0:10)*(1-p.remote/100));
  const energy=clamp((23+.42*visits+.35*mobility)*(1-.0075*p.clean));
  const choice=clamp(.40*opportunity+.25*p.education+.25*p.youth+.10*p.remote-.10*pressure);
  return {name:names[i],population,budget,pressure,visits,opportunity,service,mobility,energy,choice,x:positions[i][0],y:positions[i][1]};
 });
 const metrics={hubShare:pop[4]/200000*100};
 ['service','mobility','energy','choice','visits','pressure','opportunity'].forEach(k=>metrics[k]=cities.reduce((s,c)=>s+c[k]*c.population/200000,0));
 return {year,population:pop.reduce((a,b)=>a+b,0),cities,metrics};
}
function simulate(input=defaults,years=20,seed=42){
 const p=normalize(input);years=Math.floor(clamp(years,0,20));
 // Seed fixes small city-specific opportunity differences; no fresh random draws.
 let pop=names.map(()=>40000),history=[snapshot(pop,defaults,0)],flows=[];
 const jitter=names.map((_,i)=>(((seed*(i+3)*9301+49297)%233280)/233280-.5)*1.5);
 for(let y=1;y<=years;y++){
  const prev=snapshot(pop,p,y-1);
  const utility=prev.cities.map((c,i)=>.56*c.opportunity+.30*c.service-.38*c.pressure-.18*c.mobility+jitter[i]);
  const mx=Math.max(...utility),weights=utility.map(u=>Math.exp((u-mx)/12)),sum=weights.reduce((a,b)=>a+b,0);
  // Common migration friction (care/relationships not separately modeled): 2.5–5%, hard cap 6%.
  const rate=Math.min(.06,.025+.00025*p.remote);
  const matrix=pop.map((n,i)=>weights.map((w,j)=>i===j?0:n*rate*w/sum));
  flows.push({year:y,rate,matrix,outflow:matrix.map(row=>row.reduce((a,b)=>a+b,0)),inflow:pop.map((_,j)=>matrix.reduce((s,row)=>s+row[j],0))});
  pop=pop.map((n,i)=>n*(1-rate)+200000*rate*weights[i]/sum);
  pop[4]+=200000-pop.reduce((a,b)=>a+b,0);
  history.push(snapshot(pop,p,y));
 }
 return {inputs:p,seed,budget:100,flows,history,final:history[years]};
}
const households=['맞벌이·자녀','원격근무','현장노동','고령·돌봄'];
function household(state,p,type=0,city=0){
 const c=state.cities[city], travelFactor=[1.12,.45,1.4,.85][type],remoteEffect=[.15,.65,.02,.06][type];
 const burden=clamp(c.mobility*travelFactor*(1-remoteEffect*p.remote/100)+[6,0,8,12][type]);
 const service=clamp(c.service+[p.education*.12,p.ai*.10,-3,-8][type]-burden*.12);
 const choice=clamp(c.choice+[0,p.remote*.16,-burden*.14,-burden*.2][type]);
 const trips=Math.max(0,Math.round((type===2?5:type===1?2:4)*(1-.006*p.travel)));
 const story=[`등하교·돌봄과 출근을 함께 조율합니다. 교육/탐색 접근 ${p.education}이 선택 여건에 반영됩니다.`,`원격근무 가능 ${p.remote}에 따라 통근 부담이 줄지만, 플랫폼 수익 집중 ${p.platform}은 지역 기회를 낮춥니다.`,`원격으로 대체하기 어려운 현장 업무입니다. 이동 에너지 부담 ${p.travel}이 이동 부담에 더 크게 반영됩니다.`,`돌봄·진료 접근을 우선합니다. 도시 서비스와 이동 부담을 함께 고려하며 관계·돌봄을 구분하지 않은 공통 이주마찰을 가정합니다.`][type];
 return {burden,service,choice,trips,story:`${c.name}에서 보내는 가상 한 주. 교류·서비스 방문 약 ${trips}회(설명용 환산, 출근 횟수 아님). ${story}`};
}
function communities(s,p){const m=s.metrics;return [
 ['가정','발견',m.choice,`교육/탐색 ${p.education}과 선택기회 ${m.choice.toFixed(0)}. 주거압력 ${m.pressure.toFixed(0)}이 탐색 여유를 제약.`],
 ['이웃','교류',m.visits,`협력 ${p.cooperation}·이동비 ${p.travel} → 방문 ${m.visits.toFixed(0)}. 관계·돌봄을 구분하지 않는 공통 이주마찰 가정: 연간 최대 6%.`],
 ['마을','개발',m.opportunity,`AI 접근 ${p.ai}·수익 집중 ${p.platform} → 기회 ${m.opportunity.toFixed(0)}. 지역 개발 역량의 대리지수.`],
 ['도시','발현',m.service,`거점 예산 ${p.hubBudget} → 서비스 ${m.service.toFixed(0)}. 인구 재집중 시 혼잡이 접근을 낮춤.`],
 ['국가','보장',100-m.pressure,`총 공공예산 100 고정. 주거압력 ${m.pressure.toFixed(0)}에 따라 보장 여건이 제약됨.`],
 ['세계','확장',(p.cooperation+p.trade+m.opportunity)/3,`협력 ${p.cooperation}·교역 ${p.trade}·도시 기회 ${m.opportunity.toFixed(0)} → 확장 여건. 외부 충격은 별도 미모형화.`]
 ];}
const api={defaults,scenarios,fields,households,simulate,household,communities,normalize};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CommunityModel=api;
})(typeof window!=='undefined'?window:globalThis);
