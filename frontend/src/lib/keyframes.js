export const KEYFRAMES = `
@keyframes er-fall { 0%{transform:translateY(-10px) rotate(0);opacity:1} 100%{transform:translateY(360px) rotate(540deg);opacity:0} }
@keyframes er-pop { 0%{transform:scale(0);opacity:0} 40%{transform:scale(1.25);opacity:1} 100%{transform:scale(1);opacity:0} }
@keyframes er-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes er-dance { 0%,100%{transform:rotate(-8deg) translateY(0)} 50%{transform:rotate(8deg) translateY(-4px)} }
@keyframes er-note { 0%{transform:translate(0,0) scale(.6);opacity:0} 20%{opacity:1} 100%{transform:translate(12px,-32px) scale(1.2);opacity:0} }
@keyframes er-thump { 0%,100%{transform:scale(1) rotate(-10deg)} 50%{transform:scale(1.35) rotate(-10deg)} }
@keyframes er-dash { to { stroke-dashoffset: -18; } }
@keyframes er-flash { 0%{background-color:rgba(16,185,129,0.28)} 100%{background-color:rgba(2,6,23,0.6)} }
.er-fall{ animation-name:er-fall; animation-timing-function:ease-in; animation-iteration-count:infinite; }
.er-pop{ animation:er-pop 1.1s ease-out; }
.er-bob{ animation:er-bob .7s ease-in-out infinite; }
.er-dash{ animation:er-dash .6s linear infinite; }
.er-flash{ animation:er-flash 1.2s ease-out; }
.er-dance{ animation:er-dance .55s ease-in-out infinite; }
.er-note{ animation:er-note 1.6s ease-out infinite; }
.er-thump{ animation:er-thump .55s ease-in-out infinite; }
.er-tile-label{ text-shadow: 0 1px 2px rgba(2,6,23,.95), 0 0 4px rgba(2,6,23,.85); }
`;
