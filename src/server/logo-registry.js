// Bundled logo registry. Keep this as JavaScript rather than reading data/logos.json
// at runtime so serverless deployments never depend on the filesystem containing
// the source-data directory.
export default [
  {id:"apple-001",brand:"Apple",difficulty:"easy",points:1,acceptableAnswers:["apple"],reveal:[{x:360,y:210,w:300,h:360},{x:300,y:470,w:200,h:120}]},
  {id:"nike-001",brand:"Nike",difficulty:"easy",points:1,acceptableAnswers:["nike"],reveal:[{x:120,y:430,w:420,h:140},{x:400,y:300,w:220,h:120}]},
  {id:"mcdonalds-001",brand:"McDonald's",difficulty:"easy",points:1,acceptableAnswers:["mcdonalds","mcdonald's","mc donalds","maccas"],reveal:[{x:190,y:260,w:250,h:360}]},
  {id:"adidas-001",brand:"Adidas",difficulty:"easy",points:1,acceptableAnswers:["adidas"],reveal:[{x:240,y:380,w:360,h:200}]},
  {id:"mercedes-001",brand:"Mercedes-Benz",difficulty:"easy",points:1,acceptableAnswers:["mercedes","mercedes benz","mercedes-benz","benz"],reveal:[{cx:400,cy:300,r:150},{x:380,y:210,w:200,h:300}]},
  {id:"starbucks-001",brand:"Starbucks",difficulty:"easy",points:1,acceptableAnswers:["starbucks"],reveal:[{cx:400,cy:400,r:210},{x:190,y:190,w:420,h:180}]},
  {id:"shell-001",brand:"Shell",difficulty:"easy",points:1,acceptableAnswers:["shell"],reveal:[{x:250,y:250,w:300,h:240},{x:330,y:430,w:180,h:150}]},
  {id:"lego-001",brand:"LEGO",difficulty:"easy",points:1,acceptableAnswers:["lego"],reveal:[{x:220,y:250,w:360,h:220},{x:330,y:420,w:180,h:160}]},
  {id:"spotify-001",brand:"Spotify",difficulty:"medium",points:2,acceptableAnswers:["spotify"],reveal:[{x:270,y:320,w:210,h:190}]},
  {id:"airbnb-001",brand:"Airbnb",difficulty:"medium",points:2,acceptableAnswers:["airbnb","air bnb"],reveal:[{x:320,y:235,w:220,h:230}]},
  {id:"fedex-001",brand:"FedEx",difficulty:"medium",points:2,acceptableAnswers:["fedex","fed ex"],reveal:[{x:130,y:300,w:360,h:190}]},
  {id:"dropbox-001",brand:"Dropbox",difficulty:"medium",points:2,acceptableAnswers:["dropbox","drop box"],reveal:[{x:180,y:240,w:240,h:190}]},
  {id:"slack-001",brand:"Slack",difficulty:"medium",points:2,acceptableAnswers:["slack"],reveal:[{x:240,y:350,w:200,h:160}]},
  {id:"pinterest-001",brand:"Pinterest",difficulty:"medium",points:2,acceptableAnswers:["pinterest"],reveal:[{x:340,y:300,w:180,h:200}]},
  {id:"amplitude-001",brand:"Amplitude",difficulty:"medium",points:2,acceptableAnswers:["amplitude"],reveal:[{x:300,y:230,w:250,h:310}]},
  {id:"mailchimp-001",brand:"Mailchimp",difficulty:"hard",points:3,acceptableAnswers:["mailchimp","mail chimp"],reveal:[{x:300,y:300,w:170,h:150}]},
  {id:"figma-001",brand:"Figma",difficulty:"hard",points:3,acceptableAnswers:["figma"],reveal:[{x:295,y:320,w:205,h:200}]},
  {id:"rolex-001",brand:"Rolex",difficulty:"hard",points:3,acceptableAnswers:["rolex"],reveal:[{x:280,y:220,w:260,h:260},{x:360,y:450,w:100,h:150}]},
  {id:"liverpool-001",brand:"Liverpool",difficulty:"hard",points:3,acceptableAnswers:["liverpool","liverpool fc","liverpool football club"],reveal:[{x:240,y:230,w:260,h:300},{x:430,y:380,w:180,h:180}]},
  {id:"quaker-001",brand:"Quaker",difficulty:"hard",points:3,acceptableAnswers:["quaker"],reveal:[{x:250,y:230,w:260,h:330},{x:430,y:300,w:170,h:190}]},
  {id:"warner-bros-001",brand:"Warner Bros.",assetFile:"WB_black.svg",difficulty:"hard",points:3,acceptableAnswers:["warner bros","warner bros.","warner brothers","wb"],reveal:[{x:280,y:230,w:250,h:300},{x:430,y:420,w:170,h:140}]}
];
