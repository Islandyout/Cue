import { normalise, splitSentences, DEFAULT_LEXICON, buildScript, clock, estimateSeconds } from '../src/script.js';
let pass = 0, fail = 0;
const eq = (label, got, want) => { if (got === want) pass++; else { fail++; console.log(`X ${label}\n   got:  ${got}\n   want: ${want}`);} };
const has = (label, got, want) => { if (String(got).includes(want)) pass++; else { fail++; console.log(`X ${label}\n   got:  ${got}\n   want to contain: ${want}`);} };
const L = DEFAULT_LEXICON;
eq('money plain',      normalise('J$2,500', L), 'two thousand five hundred Jamaican dollars');
eq('money big',        normalise('J$1,902,360', L), 'one million nine hundred and two thousand three hundred and sixty Jamaican dollars');
eq('money cents',      normalise('J$637.50', L), 'six hundred and thirty-seven Jamaican dollars and fifty cents');
eq('money round',      normalise('J$805.00', L), 'eight hundred and five Jamaican dollars');
eq('money magnitude',  normalise('J$1.8m', L), 'one point eight million Jamaican dollars');
eq('money k',          normalise('J$270k', L), 'two hundred and seventy thousand Jamaican dollars');
eq('us money',         normalise('US$40', L), 'forty US dollars');
eq('percent',          normalise('12.5%', L), 'twelve point five percent');
eq('percent signed',   normalise('+50%', L), 'plus fifty percent');
eq('percent whole',    normalise('25%', L), 'twenty-five percent');
eq('date full',        normalise('1 July 2026', L), 'the first of July twenty twenty-six');
eq('date short',       normalise('15 February', L), 'the fifteenth of February');
eq('year',             normalise('in 2016', L), 'in twenty sixteen');
eq('year 2000s',       normalise('in 2005', L), 'in two thousand and five');
eq('chapter ref',      normalise('Ch. 3', L), 'chapter three');
eq('chapter range',    normalise('Chapters 1-3', L), 'chapters one to three');
eq('section ref',      normalise('section 7.4', L), 'section seven point four');
eq('fiscal',           normalise('2026/27 fiscal year', L), 'twenty twenty-six to twenty twenty-seven fiscal year');
eq('range',            normalise('3-5 hours', L), 'three to five hours');
eq('ordinal',          normalise('the 14th day', L), 'the fourteenth day');
eq('phone',            normalise('(876) 908-4419', L), 'eight seven six, nine zero eight, four four one nine');
eq('email',            normalise('custsupport@orcjamaica.com', L), 'custsupport at orcjamaica dot com');
eq('website',          normalise('www.jamaicatax.gov.jm', L), 'the website jamaicatax dot gov dot jm');
eq('acronym',          normalise('NIS and NHT', L), 'N I S and N H T');
eq('paye',             normalise('PAYE applies', L), 'pay as you earn applies');
eq('slash',            normalise('employer / employee', L), 'employer, employee');
eq('arrow',            normalise('Kingston -> St. Thomas', L), 'Kingston to St. Thomas');
has('mixed sentence',  normalise('Budget J$40,000 to J$80,000 annually.', L), 'forty thousand Jamaican dollars to eighty thousand');
has('rate line',       normalise('minimum wage is J$17,000 per week, which is J$425 per hour.', L), 'seventeen thousand Jamaican dollars');
has('table cell',      normalise('3.5% / 2.25%', L), 'three point five percent, two point two five percent');
eq('sentences count', splitSentences('You are not in cleaning. You place a vetted person. The cleaning is the product.').length, 3);
eq('abbrev safe',     splitSentences('Travel from Yallahs to St. Thomas takes an hour. Ch. 3 explains why.').length, 2);
eq('money sentence',  splitSentences('It cost J$2,500. Then it rose.').length, 2);
const doc = { title:'T', blocks:[
  { type:'h2', text:'Chapter 8 - Pricing', runs:[{text:'Chapter 8 - Pricing',bold:true}] },
  { type:'p', text:'Build every price from the bottom up. It costs J$805 per hour.',
    runs:[{text:'Build every price from the bottom up. ',bold:false},{text:'It costs J$805 per hour.',bold:true}] },
  { type:'li', ordered:true, items:[{text:'First thing',runs:[{text:'First thing'}]},{text:'Second thing',runs:[{text:'Second thing'}]}], text:'' },
  { type:'table', header:['Deduction','Employer','Employee'], rows:[['NIS','3%','3%'],['NHT','3%','2%']], text:'' },
]};
const { segments, chapters } = buildScript(doc, { lexicon:L });
eq('has chapter', chapters.length, 1);
has('table row spoken', segments.find(s=>s.role==='table').spoken, 'Employer, three percent');
has('ordered prefix', segments.find(s=>s.role==='li').spoken, 'one. First thing');
eq('emphasis detected', segments.filter(s=>s.emphasis).length > 0, true);
eq('clock', clock(3725), '1:02:05');
eq('duration sane', estimateSeconds(segments) > 0, true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
