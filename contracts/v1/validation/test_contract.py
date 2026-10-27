import copy
import json
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator
from validate_bundle import ROOT,SCHEMA,validate,derive_indices,wordcount

BASE=json.loads((ROOT/'examples/text-only-session.json').read_text())
APPEND=json.loads((ROOT/'examples/append-rescore.json').read_text())
LIVE=json.loads((ROOT/'examples/live-audio-provisional.json').read_text())

class ContractTests(unittest.TestCase):
    def setUp(self): self.d=copy.deepcopy(BASE)
    def bad(self): self.assertTrue(validate(self.d)['errors'])
    def test_schema_is_valid(self): Draft202012Validator.check_schema(SCHEMA)
    def test_text_only_example(self): self.assertEqual(validate(self.d)['errors'],[])
    def test_append_with_context(self): self.assertEqual(validate(APPEND,BASE)['errors'],[])
    def test_append_without_context_rejected(self): self.assertTrue(validate(APPEND)['errors'])
    def test_provisional_live_audio_valid(self): self.assertEqual(validate(LIVE)['errors'],[])
    def test_live_audio_is_separate_series(self):
        q={x['question_id']:x for x in LIVE['question_sets'][0]['questions']}
        out=derive_indices(LIVE['assessments'][0],q)
        self.assertEqual(out['audio'],75); self.assertEqual(out['audio_mode'],'provisional')
    def test_live_audio_confidence_cap(self):
        self.d=copy.deepcopy(LIVE)
        self.d['assessments'][0]['task_results'][0]['criteria'][4]['confidence']='high'; self.bad()
    def test_live_audio_needs_observation_in_input(self):
        self.d=copy.deepcopy(LIVE)
        self.d['assessments'][0]['input']['live_capture_ids']=[]; self.bad()
    def test_unknown_key(self): self.d['overall_cse_prediction']=700; self.bad()
    def test_invalid_date(self): self.d['session']['started_at']='2026-99-99T12:00:00+09:00'; self.bad()
    def test_score_range(self): self.d['assessments'][0]['task_results'][0]['criteria'][0]['score']=5; self.bad()
    def test_missing_is_not_zero(self): self.d['assessments'][0]['task_results'][0]['criteria'][4]['score']=0; self.bad()
    def test_scored_cannot_be_null(self): self.d['assessments'][0]['task_results'][0]['criteria'][0]['score']=None; self.bad()
    def test_hallucinated_quote(self): self.d['assessments'][0]['findings'][0]['evidence_refs'][0]['quote']='A sentence never spoken.'; self.bad()
    def test_char_range(self): self.d['assessments'][0]['findings'][0]['evidence_refs'][0]['char_end']+=1; self.bad()
    def test_missing_turn(self): self.d['assessments'][0]['findings'][0]['evidence_refs'][0]['turn_id']='nonexistent-turn'; self.bad()
    def test_wrong_transcript(self): self.d['assessments'][0]['input']['transcript_id']='nonexistent-transcript'; self.bad()
    def test_duplicate_criterion(self): self.d['assessments'][0]['task_results'][0]['criteria'][1]=copy.deepcopy(self.d['assessments'][0]['task_results'][0]['criteria'][0]); self.bad()
    def test_unknown_taxonomy(self): self.d['assessments'][0]['findings'][0]['taxonomy_id']='invented.taxonomy'; self.bad()
    def test_namespace_mismatch(self): self.d['assessments'][0]['findings'][0]['taxonomy_id']='strength.content.clear_position'; self.bad()
    def test_pronunciation_without_audio(self): self.d['assessments'][0]['findings'][0]['taxonomy_id']='mistake.pronunciation.word_stress'; self.bad()
    def test_speech_score_from_text(self):
        t=self.d['assessments'][0]['task_results'][0]
        c=copy.deepcopy(t['criteria'][0]); c['criterion_id']='intelligibility'; t['criteria'][4]=c; self.bad()
    def test_uncertain_not_countable(self): self.d['assessments'][0]['findings'][0]['kind']='uncertain'; self.bad()
    def test_missing_capture_not_scored(self): self.d['assessments'][0]['task_results'][0]['attempt_status']='missing_capture'; self.bad()
    def test_no_response_requires_observation(self): self.d['assessments'][0]['task_results'][0]['attempt_status']='no_response_observed'; self.bad()
    def test_profile_version(self): self.d['assessments'][0]['versions']['rubric']='99.0.0'; self.bad()
    def test_order(self): self.d['transcripts'][0]['turns'][1]['sequence']=1; self.bad()
    def test_cycle(self): self.d['transcripts'][0]['parent_transcript_id']='demo-transcript-v1'; self.bad()
    def test_slot_duplicate(self): self.d['question_sets'][0]['questions'][1]['slot']='narration'; self.bad()
    def test_metric_needs_evidence(self):
        m=self.d['assessments'][0]['metrics'][0]; m.update(value=1000,null_reason=None); self.bad()
    def test_audio_time_reversal(self):
        self.d['assets'].append({'asset_id':'demo-audio','kind':'audio','filename':'synthetic.wav','availability':'missing','path':None,'sha256':None,'mime_type':'audio/wav','duration_ms':1000,'sample_rate_hz':None,'channels':None,'speaker_coverage':'both','capture_tool':None,'rights':'synthetic fixture','notes':None})
        self.d['transcripts'][0]['turns'][0]['audio_segment']={'asset_id':'demo-audio','start_ms':900,'end_ms':800}; self.bad()
    def test_same_id_different_content_conflict(self):
        self.d['captures'][0]['content_text']+='Changed'
        self.assertTrue(validate(self.d,BASE)['errors'])
    def test_wordcount(self):
        self.assertEqual(wordcount("I'd use a part-time job in 2026."),7)
        self.assertEqual(wordcount('日本語 I’d go, um, at 8.30.'),5)
    def test_derived_indices_text_only(self):
        q={x['question_id']:x for x in self.d['question_sets'][0]['questions']}
        out=derive_indices(self.d['assessments'][0],q)
        self.assertEqual(out['text'],75); self.assertIsNone(out['audio'])
    def test_missing_component_has_no_session_index(self):
        c=self.d['assessments'][0]['task_results'][0]['criteria'][2]
        c.update(status='not_assessable',score=None,evidence_mode='none',evidence_refs=[],reason_code='uncertain_evidence',reason='ASR ambiguity')
        q={x['question_id']:x for x in self.d['question_sets'][0]['questions']}
        self.assertIsNone(derive_indices(self.d['assessments'][0],q)['text'])
    def test_weighted_index(self):
        for c in self.d['assessments'][0]['task_results'][0]['criteria'][:4]: c['score']=2
        q={x['question_id']:x for x in self.d['question_sets'][0]['questions']}
        self.assertEqual(derive_indices(self.d['assessments'][0],q)['text'],65)

if __name__=='__main__': unittest.main()
