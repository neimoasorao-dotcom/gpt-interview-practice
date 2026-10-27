"""Reference validation, not a claim that AI facts or scores are true.

Usage: python validate_bundle.py FILE [--context EXISTING_BUNDLE]
Dependency: requirements.txt. JSON Schema 2020-12 plus principal semantic rules.
The production Web app must also implement 03-codex-development.md.
"""
import argparse
import datetime
import json
import re
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT=Path(__file__).resolve().parents[1]
SCHEMA=json.loads((ROOT/'schemas/session-bundle.schema.json').read_text())
TAXONOMY=json.loads((ROOT/'profiles/taxonomy.json').read_text())
TERMS={t['id']:t for t in TAXONOMY['terms']}
TEXT_CRITERIA={'task_response','organization','grammar','vocabulary'}
AUDIO_CRITERIA={'intelligibility','fluency'}
SLOTS={'narration','q1','q2','q3','q4'}
CHECKER=FormatChecker()

@CHECKER.checks('date-time')
def strict_datetime(value):
    # jsonschema's optional date-time extras are not installed in every runtime.
    if not isinstance(value,str): return True
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})',value): return False
    try:
        dt=datetime.datetime.fromisoformat(value.replace('t','T').replace('Z','+00:00').replace('z','+00:00'))
        return dt.tzinfo is not None
    except ValueError: return False

def wordcount(text):
    text=text.replace('’',"'").replace('‘',"'")
    return len(re.findall(r"[A-Za-z]+(?:['-][A-Za-z]+)*|[0-9]+(?:[.,][0-9]+)*",text))

def derive_indices(assessment, questions):
    """Unrounded values; presentation layer rounds once. No combined overall."""
    tasks={}
    for task in assessment['task_results']:
        c={x['criterion_id']:x for x in task['criteria']}
        def score(ids):
            if not all(i in c and c[i]['status']=='scored' for i in ids): return None
            return 25*sum(c[i]['score'] for i in ids)/len(ids)
        a=score(AUDIO_CRITERIA)
        mode=None if a is None else ('provisional' if any(c[i]['evidence_mode']=='live_audio' for i in AUDIO_CRITERIA) else 'archived')
        tasks[questions[task['question_id']]['slot']]={'text':score(TEXT_CRITERIA),'audio':a,'audio_mode':mode}
    weights={'narration':.4,'q1':.15,'q2':.15,'q3':.15,'q4':.15}
    result={'tasks':tasks}
    for kind in ['text','audio']:
        result[kind]=sum(weights[s]*tasks[s][kind] for s in weights) if all(s in tasks and tasks[s][kind] is not None for s in weights) else None
    result['audio_mode']=None if result['audio'] is None else ('provisional' if any(tasks[s]['audio_mode']=='provisional' for s in weights) else 'archived')
    return result

def validate(data,context=None):
    errors=[]; warnings=[]
    def err(path,msg): errors.append(f'{path}: {msg}')
    def warn(path,msg): warnings.append(f'{path}: {msg}')
    v=Draft202012Validator(SCHEMA,format_checker=CHECKER)
    for e in sorted(v.iter_errors(data),key=lambda e:str(list(e.absolute_path))):
        err('/'+'/'.join(map(str,e.absolute_path)),e.message)
    if errors: return {'errors':errors,'warnings':warnings}
    if context is not None:
        cv=validate(context)
        if cv['errors']: return {'errors':['context is not valid: '+str(cv['errors'])],'warnings':[]}
        if data['session'] != context['session']: err('/session','context session metadata differs; resolve explicitly before merging')
    if data['bundle_mode']=='append' and context is None:
        warn('/bundle_mode','append requires existing records; unresolved references are errors below')
    collections={}
    for key,idkey in [('assets','asset_id'),('captures','capture_id'),('question_sets','question_set_id'),('transcripts','transcript_id'),('events','event_id'),('assessments','assessment_id'),('annotations','annotation_id')]:
        byid={}
        for origin,records in [('context',context.get(key,[]) if context else []),('current',data[key])]:
            seen=set()
            for r in records:
                rid=r[idkey]
                if rid in seen: err('/'+key,'duplicate ID '+rid)
                seen.add(rid)
                if rid in byid and byid[rid]!=r: err('/'+key,'same ID has different content: '+rid)
                byid[rid]=r
        collections[key]=byid
    assets=collections['assets']; captures=collections['captures']; transcripts=collections['transcripts']
    events=collections['events']; assessments=collections['assessments']; qsets=collections['question_sets']
    turns={}; questions={}; findings={}
    def need(mapping,key,path):
        if key not in mapping: err(path,'unresolved reference '+str(key)); return None
        return mapping[key]
    def audio_segment(seg,path):
        asset=need(assets,seg['asset_id'],path)
        if asset and asset['kind']!='audio': err(path,'audio reference points to a non-audio asset')
        if seg['end_ms']<=seg['start_ms']: err(path,'end_ms must exceed start_ms')
        if asset and asset['duration_ms'] is not None and seg['end_ms']>asset['duration_ms']: err(path,'audio segment exceeds asset duration')
        if asset and asset['availability']=='missing': warn(path,'archived evidence asset is currently missing; cannot replay')
    for asset in assets.values():
        if asset['sha256'] is None: warn('/assets/'+asset['asset_id'],'hash not verified')
    for cap in captures.values():
        p='/captures/'+cap['capture_id']
        if cap['content_text'] is None and cap['asset_id'] is None: err(p,'capture needs original text or an asset reference')
        if cap['asset_id'] is not None: need(assets,cap['asset_id'],p)
        if cap['kind']=='audio_recording' and (cap['asset_id'] not in assets or assets[cap['asset_id']]['kind']!='audio'): err(p,'audio_recording must reference audio')
        if cap['kind']=='model_reconstruction' and cap['verified_by']!='none': err(p,'model reconstruction is not verified raw capture')
    for qs in qsets.values():
        p='/question_sets/'+qs['question_set_id']; slots=set()
        for aid in qs['asset_ids']: need(assets,aid,p)
        for q in qs['questions']:
            if q['slot'] in slots: err(p,'duplicate slot '+q['slot'])
            slots.add(q['slot'])
            if q['question_id'] in questions and questions[q['question_id']]!=q: err(p,'question ID collision')
            questions[q['question_id']]=q
        if data['session']['mode']=='mock_interview' and data['session']['state']=='completed' and slots!=SLOTS: err(p,'completed mock requires narration and q1-q4')
    for tr in transcripts.values():
        p='/transcripts/'+tr['transcript_id']; sequences=[]
        if tr['parent_transcript_id'] is not None: need(transcripts,tr['parent_transcript_id'],p)
        for cid in tr['source_capture_ids']: need(captures,cid,p)
        if tr['kind']=='reconstruction': warn(p,'reconstructed transcript is not original verbatim speech')
        if tr['kind']=='human_verified':
            if not any(captures.get(c,{}).get('kind')=='audio_recording' for c in tr['source_capture_ids']): err(p,'human_verified requires retained audio evidence')
            if not any(captures.get(c,{}).get('verified_by') in ['learner','human'] for c in tr['source_capture_ids']): err(p,'human_verified needs a human verification record')
        for turn in tr['turns']:
            tid=turn['turn_id']; tp=p+'/'+tid
            if tid in turns: err(tp,'turn IDs must be unique across transcript versions; use previous_turn_ids')
            turns[tid]=(tr,turn); sequences.append(turn['sequence'])
            for cid in turn['source_capture_ids']: need(captures,cid,tp)
            if turn['question_id'] is not None:
                q=need(questions,turn['question_id'],tp)
                if q and turn['phase'] in SLOTS and q['slot']!=turn['phase']: err(tp,'question slot differs from turn phase')
            if turn['audio_segment'] is not None: audio_segment(turn['audio_segment'],tp)
            if turn['turn_kind']=='answer' and turn['speaker']!='learner': err(tp,'answer must belong to learner')
        if sequences != list(range(1,len(sequences)+1)): err(p,'sequence must be contiguous 1..N in recorded order')
        if tr['coverage']!='complete': warn(p,'transcript coverage is not complete')
    for tr,turn in turns.values():
        for tid in turn['previous_turn_ids']: need(turns,tid,'/turns/'+turn['turn_id'])
    def cycles(nodes,parent,path):
        for start in nodes:
            seen=set(); stack=[start]
            while stack:
                node=stack.pop()
                if node in seen: continue
                seen.add(node)
                for target in parent(nodes[node]):
                    if target==start: err(path,'cycle including '+start); stack=[]; break
                    if target in nodes: stack.append(target)
    cycles(transcripts,lambda t:[] if t['parent_transcript_id'] is None else [t['parent_transcript_id']],'/transcripts')
    cycles(turns,lambda tt:tt[1]['previous_turn_ids'],'/turns')
    for event in events.values():
        p='/events/'+event['event_id']
        need(captures,event['source_capture_id'],p)
        if event['turn_id'] is not None: need(turns,event['turn_id'],p)
    def evidence(refs,assessment,path,task_id=None):
        for e in refs:
            if e['kind']=='turn':
                need(transcripts,e['transcript_id'],path)
                tt=need(turns,e['turn_id'],path)
                if e['transcript_id']!=assessment['input']['transcript_id']: err(path,'evidence uses a different transcript version from assessment input')
                if tt:
                    tr,t=tt; text=t['text'] or ''
                    if tr['transcript_id']!=e['transcript_id']: err(path,'turn does not belong to evidence transcript')
                    if task_id and t['question_id']!=task_id: err(path,'evidence belongs to another question')
                    if e['quote'] is not None and e['quote'] not in text: err(path,'quote is not present in original text')
                    if (e['char_start'] is None)!=(e['char_end'] is None): err(path,'both character boundaries are required together')
                    if e['char_start'] is not None and e['char_end'] is not None:
                        a,b=e['char_start'],e['char_end']
                        if not 0<=a<b<=len(text): err(path,'invalid Unicode codepoint range')
                        elif e['quote'] is not None and text[a:b]!=e['quote']: err(path,'quote does not match character span')
            elif e['kind']=='audio':
                audio_segment(e,path)
                if e['asset_id'] not in assessment['input']['asset_ids']: err(path,'audio was not part of assessment input')
            elif e['kind']=='capture':
                cap=need(captures,e['capture_id'],path)
                if cap and e['quote'] is not None and e['quote'] not in (cap['content_text'] or ''): err(path,'capture quote mismatch')
            elif e['kind']=='event': need(events,e['event_id'],path)
    def criteria(items,a,path,expected,task=None):
        ids=[c['criterion_id'] for c in items]
        if len(ids)!=len(set(ids)) or set(ids)!=expected: err(path,'criterion set or uniqueness mismatch')
        for c in items:
            cp=path+'/'+c['criterion_id']; evidence(c['evidence_refs'],a,cp,task['question_id'] if task else None)
            if c['status']!='scored': continue
            kinds={e['kind'] for e in c['evidence_refs']}
            if c['criterion_id'] in AUDIO_CRITERIA and c['evidence_mode'] not in ['archived_audio','live_audio']: err(cp,'speech score requires real audio evidence')
            if c['evidence_mode']=='archived_audio' and 'audio' not in kinds: err(cp,'archived score needs audio segment evidence')
            if c['evidence_mode']=='text' and 'turn' not in kinds: err(cp,'text score needs transcript evidence')
            if c['evidence_mode']=='event' and 'event' not in kinds: err(cp,'event score needs event evidence')
            if c['evidence_mode']=='live_audio':
                if c['confidence']=='high': err(cp,'live audio confidence is at most medium')
                live=[e['capture_id'] for e in c['evidence_refs'] if e['kind']=='capture']
                if not live or not all(cid in a['input']['live_capture_ids'] and captures.get(cid,{}).get('kind')=='live_observation' for cid in live): err(cp,'live score requires input live_observation capture')
            if task:
                if c['evidence_mode']=='text' and c['criterion_id'] in TEXT_CRITERIA:
                    if not any(e['kind']=='turn' and turns.get(e['turn_id'],({},{}))[1].get('speaker')=='learner' and turns[e['turn_id']][1].get('turn_kind')=='answer' for e in c['evidence_refs']): err(cp,'task text criterion needs learner answer evidence')
                if task['attempt_status'] in ['missing_capture','not_asked']: err(cp,'missing/not asked is not a scored answer')
                if task['attempt_status']=='no_response_observed':
                    if c['criterion_id']!='task_response' or c['score']!=0: err(cp,'no response: only task_response can be scored 0')
                    if not any(e['kind']=='event' and events.get(e['event_id'],{}).get('kind')=='no_response_observed' for e in c['evidence_refs']): err(cp,'no response needs observation event')
                if c['criterion_id'] in ['grammar','vocabulary']:
                    tr=transcripts.get(a['input']['transcript_id'],{})
                    words=sum(wordcount(t['text'] or '') for t in tr.get('turns',[]) if t['speaker']=='learner' and t['turn_kind']=='answer' and t['question_id']==task['question_id'])
                    if words<5: err(cp,'insufficient sample for grammar/vocabulary')
    for a in assessments.values():
        p='/assessments/'+a['assessment_id']
        tr=need(transcripts,a['input']['transcript_id'],p)
        qs=need(qsets,a['input']['question_set_id'],p)
        for key in ['rubric','taxonomy','evaluator_prompt','metrics']:
            if a['versions'][key]!='1.0.0': err(p,'unavailable profile version: '+key+' '+a['versions'][key])
        for aid in a['input']['asset_ids']: need(assets,aid,p)
        for cid in a['input']['live_capture_ids']:
            cap=need(captures,cid,p)
            if cap and cap['kind']!='live_observation': err(p,'live_capture_ids must reference live_observation')
        if a['evaluator']['model_id'] is None: warn(p,'exact evaluation model is unknown; do not assert same-model comparability')
        if a['supersedes_assessment_id'] is not None: need(assessments,a['supersedes_assessment_id'],p)
        tids=[t['question_id'] for t in a['task_results']]
        if len(tids)!=len(set(tids)): err(p,'duplicate task result')
        if qs and not set(tids)<=set(q['question_id'] for q in qs['questions']): err(p,'task does not belong to input question set')
        if data['session']['mode']=='mock_interview' and data['session']['state']=='completed' and qs and set(tids)!=set(q['question_id'] for q in qs['questions']): err(p,'completed mock needs result including unscored status for every task')
        for task in a['task_results']: criteria(task['criteria'],a,p+'/tasks/'+task['question_id'],TEXT_CRITERIA|AUDIO_CRITERIA,task)
        criteria(a['session_criteria'],a,p+'/session',{'interaction'})
        for task in a['task_results']:
            for ns,key in [('topic','topic_ids'),('question','question_type_ids')]:
                for term in task[key]:
                    if term not in TERMS or TERMS[term]['namespace']!=ns: err(p,'unknown or mismatched '+ns+' term '+term)
        for f in a['findings']:
            fp=p+'/findings/'+f['finding_id']
            if f['finding_id'] in findings: err(fp,'duplicate finding ID')
            findings[f['finding_id']]=f
            if f['question_id'] is not None: need(questions,f['question_id'],fp)
            evidence(f['evidence_refs'],a,fp,f['question_id'])
            if f['kind'] in ['uncertain','style_suggestion'] and f['countable']: err(fp,'uncertain/style must not be counted as mistakes or strengths')
            if f['kind'] in ['mistake','strength'] and f['taxonomy_id'] is None: err(fp,'confirmed finding needs taxonomy ID')
            for term in ([f['taxonomy_id']] if f['taxonomy_id'] else [])+f['secondary_taxonomy_ids']:
                if term not in TERMS: err(fp,'unknown taxonomy '+term); continue
                if f['kind'] in ['mistake','strength'] and TERMS[term]['namespace']!=f['kind']: err(fp,'finding namespace mismatch')
                if TERMS[term]['requires_audio'] and not any(e['kind']=='audio' or (e['kind']=='capture' and captures.get(e['capture_id'],{}).get('kind')=='live_observation' and e['capture_id'] in a['input']['live_capture_ids']) for e in f['evidence_refs']): err(fp,'audio taxonomy needs actual audio evidence')
            if f['kind']=='mistake' and f['severity'] is None: err(fp,'mistake needs severity')
        for rewrite in a['rewrites']: need(questions,rewrite['question_id'],p)
        priorities=[r['priority'] for r in a['recommendations']]
        if len(priorities)!=len(set(priorities)): err(p,'duplicate recommendation priority')
        for r in a['recommendations']:
            for fid in r['related_finding_ids']:
                if fid not in {f['finding_id'] for f in a['findings']}: err(p,'recommendation finding not in this assessment')
        units={'duration_ms':'ms','response_latency_ms':'ms','wpm':'words_per_minute','long_pause_count':'count'}
        for m in a['metrics']:
            mp=p+'/metrics/'+m['metric_id']
            if m['unit']!=units[m['metric_id']]: err(mp,'metric unit mismatch')
            if m['question_id'] is not None: need(questions,m['question_id'],mp)
            for aid in m['source_asset_ids']: need(assets,aid,mp)
            for tid in m['source_turn_ids']: need(turns,tid,mp)
            if m['value'] is None:
                if m['null_reason'] is None: err(mp,'null metric requires reason')
            else:
                if m['null_reason'] is not None: err(mp,'observed value must not have null reason')
                if m['evidence_mode']=='none': err(mp,'value requires measurement evidence')
                if m['evidence_mode']=='archived_audio' and (not m['source_asset_ids'] or not all(assets.get(x,{}).get('kind')=='audio' and x in a['input']['asset_ids'] for x in m['source_asset_ids'])): err(mp,'audio metric requires input audio assets')
                if m['evidence_mode']=='measurement_log' and captures.get(m['source_capture_id'],{}).get('kind')!='measurement_log': err(mp,'metric requires measurement_log capture')
                if m['metric_id']=='long_pause_count' and m['value']!=int(m['value']): err(mp,'pause count must be an integer')
    cycles(assessments,lambda a:[] if a['supersedes_assessment_id'] is None else [a['supersedes_assessment_id']],'/assessments')
    maps={'assessment':assessments,'finding':findings,'transcript':transcripts,'turn':turns}
    for n in collections['annotations'].values():
        need(maps[n['target_type']],n['target_id'],'/annotations/'+n['annotation_id'])
        if n['action']=='select_default' and n['target_type']!='assessment': err('/annotations','select_default must target an assessment')
    return {'errors':errors,'warnings':warnings}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('file'); parser.add_argument('--context')
    args=parser.parse_args()
    data=json.loads(Path(args.file).read_text())
    context=json.loads(Path(args.context).read_text()) if args.context else None
    Draft202012Validator.check_schema(SCHEMA)
    result=validate(data,context)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(1 if result['errors'] else 0)

if __name__=='__main__': main()
