import test from 'node:test';
import assert from 'node:assert/strict';
import {
  viewerId, people, rooms, createDemoState, selectRoom, setDraft, sendMessage,
  confirmProposal, editProposal, ignoreProposal, reviveProposal,
  setRSVP, updatePromise, cancelPromise,
} from '../docs/demo-state.mjs';

const directId = 'direct-minseo';
const groupId = 'group-weekend';
const confirmedId = 'promise-weekend-picnic';
const confirmedGroup = () => confirmProposal(createDemoState(), groupId);
const getPromise = (state, id = confirmedId) => state.promises.find(item => item.id === id);
const fails = action => assert.throws(action, error => error instanceof Error && /[가-힣]/.test(error.message));

test('synthetic room members resolve to synthetic people', () => {
  assert.equal(viewerId, 'me');
  assert.equal(rooms.length, 3);
  assert.ok(rooms.some(room => room.kind === 'group'));
  assert.ok(rooms.some(room => room.kind === 'direct'));
  for (const room of rooms) for (const id of room.participantIds) assert.ok(people[id]);
});

test('new session has pending AI candidates, with one explicitly labelled seed promise', () => {
  const state = createDemoState();
  assert.equal(state.promises.length, 1);
  assert.match(state.promises[0].notes, /합성/);
  assert.ok(Object.values(state.proposalsByRoom).every(item => item.status === 'pending'));
});

test('separate demo sessions share no mutable state', () => {
  const first = createDemoState();
  const second = createDemoState();
  assert.notEqual(first, second);
  assert.notEqual(first.promises, second.promises);
  assert.deepEqual(first, second);
});

test('state and exported synthetic fixtures are deeply immutable', () => {
  const state = createDemoState();
  assert.throws(() => { state.promises[0].rsvp.hajun = 'going'; }, TypeError);
  assert.throws(() => { people.minseo.name = '다른 이름'; }, TypeError);
  assert.throws(() => { rooms[0].participantIds.push('outsider'); }, TypeError);
});

test('switching rooms preserves draft, candidate edits and existing messages', () => {
  let state = setDraft(createDemoState(), directId, '아직 보내지 않은 메시지');
  state = editProposal(state, directId, { place: '새로운 합성 카페' });
  const messages = state.messagesByRoom[directId];
  state = selectRoom(state, groupId);
  state = selectRoom(state, directId);
  assert.equal(state.draftsByRoom[directId], '아직 보내지 않은 메시지');
  assert.equal(state.proposalsByRoom[directId].place, '새로운 합성 카페');
  assert.deepEqual(state.messagesByRoom[directId], messages);
});

test('room navigation never creates a promise', () => {
  const state = createDemoState();
  const next = selectRoom(selectRoom(state, groupId), directId);
  assert.equal(next.promises.length, state.promises.length);
  assert.equal(next.proposalsByRoom[groupId].status, 'pending');
});

test('unknown room navigation is rejected', () => fails(() => selectRoom(createDemoState(), 'production')));

test('drafts are isolated by room and original state is unchanged', () => {
  const original = createDemoState();
  const next = setDraft(original, groupId, '그룹 메시지');
  assert.equal(next.draftsByRoom[groupId], '그룹 메시지');
  assert.equal(next.draftsByRoom[directId], '');
  assert.equal(original.draftsByRoom[groupId], '');
});

test('empty drafts are allowed but non-text drafts are rejected', () => {
  assert.equal(setDraft(createDemoState(), directId, '').draftsByRoom[directId], '');
  fails(() => setDraft(createDemoState(), directId, { text: '객체' }));
});

test('message size is capped at 2000 characters', () => {
  fails(() => setDraft(createDemoState(), directId, '가'.repeat(2001)));
  fails(() => sendMessage(createDemoState(), directId, '가'.repeat(2001)));
});

test('send appends text-only message and clears only the target draft', () => {
  let state = setDraft(createDemoState(), directId, '보내기');
  state = setDraft(state, groupId, '유지할 초안');
  const next = sendMessage(state, directId, '안녕하세요');
  const message = next.messagesByRoom[directId].at(-1);
  assert.equal(message.text, '안녕하세요');
  assert.equal(message.kind, 'text');
  assert.equal(message.senderId, viewerId);
  assert.equal(next.draftsByRoom[directId], '');
  assert.equal(next.draftsByRoom[groupId], '유지할 초안');
  assert.equal(state.draftsByRoom[directId], '보내기');
});

test('sending chat cannot auto-confirm an AI proposal', () => {
  const state = createDemoState();
  const next = sendMessage(state, directId, '좋아 확정하자!');
  assert.equal(next.promises.length, state.promises.length);
  assert.equal(next.proposalsByRoom[directId].status, 'pending');
});

test('message IDs stay unique across repeated sends and room switches', () => {
  let state = sendMessage(createDemoState(), directId, '첫 번째');
  state = selectRoom(state, groupId);
  state = sendMessage(state, groupId, '두 번째');
  state = sendMessage(state, directId, '세 번째');
  const ids = Object.values(state.messagesByRoom).flat().map(message => message.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('blank, object and unknown-room messages are rejected', () => {
  fails(() => sendMessage(createDemoState(), directId, '  \n '));
  fails(() => sendMessage(createDemoState(), directId, { html: 'text' }));
  fails(() => sendMessage(createDemoState(), 'missing', 'text'));
});

test('XSS payload remains inert text data in messages and drafts', () => {
  const payload = '<img src=x onerror=alert(1)><script>globalThis.pwned=1</script>';
  const drafted = setDraft(createDemoState(), directId, payload);
  const sent = sendMessage(drafted, directId, payload);
  assert.equal(drafted.draftsByRoom[directId], payload);
  assert.equal(sent.messagesByRoom[directId].at(-1).text, payload);
  assert.equal(globalThis.pwned, undefined);
});

test('candidate edit stays pending and does not save a promise', () => {
  const state = createDemoState();
  const next = editProposal(state, directId, { title: '새로운 커피 약속', time: '14:30', endTime: '15:30' });
  assert.equal(next.proposalsByRoom[directId].status, 'pending');
  assert.equal(next.promises.length, state.promises.length);
  assert.equal(state.proposalsByRoom[directId].time, '14:00');
});

test('explicit host confirmation creates one promise and marks its candidate confirmed', () => {
  const state = createDemoState();
  const next = confirmProposal(state, directId);
  assert.equal(next.promises.length, state.promises.length + 1);
  assert.equal(next.proposalsByRoom[directId].status, 'confirmed');
  assert.equal(next.proposalsByRoom[directId].promiseId, 'promise-coffee-saturday');
  assert.equal(state.proposalsByRoom[directId].status, 'pending');
});

test('repeated confirmation is idempotent without duplicate promises or history', () => {
  const first = confirmedGroup();
  const second = confirmProposal(first, groupId);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test('group host confirmation leaves every RSVP pending', () => {
  const promise = getPromise(confirmedGroup());
  assert.equal(promise.status, 'confirmed');
  for (const id of promise.participantIds) assert.equal(promise.rsvp[id], 'pending');
});

test('ignored candidate creates no promise', () => {
  const state = createDemoState();
  const next = ignoreProposal(state, directId);
  assert.equal(next.proposalsByRoom[directId].status, 'ignored');
  assert.equal(next.promises.length, state.promises.length);
});

test('ignored candidate must be reopened before confirmation', () => {
  const ignored = ignoreProposal(createDemoState(), directId);
  fails(() => confirmProposal(ignored, directId));
  const reopened = reviveProposal(ignored, directId);
  assert.equal(reopened.proposalsByRoom[directId].status, 'pending');
  assert.equal(confirmProposal(reopened, directId).promises.length, ignored.promises.length + 1);
});

test('confirmed candidate cannot be ignored, revived or edited', () => {
  const state = confirmedGroup();
  fails(() => ignoreProposal(state, groupId));
  fails(() => reviveProposal(state, groupId));
  fails(() => editProposal(state, groupId, { title: '잘못된 변경' }));
});

test('candidate patches cannot change host, participants, status, id or promiseId', () => {
  for (const patch of [{ hostId: 'minseo' }, { participantIds: ['minseo'] }, { status: 'confirmed' }, { id: 'forged' }, { promiseId: 'forged' }]) {
    fails(() => editProposal(createDemoState(), groupId, patch));
  }
});

test('candidate patch rejects malformed object types', () => {
  for (const patch of [null, undefined, 'text', [], 42]) fails(() => editProposal(createDemoState(), directId, patch));
});

test('date validation rejects impossible, ambiguous and non-string dates', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '26-10-17', '2026-10-17T14:00:00Z', '', null]) {
    fails(() => editProposal(createDemoState(), directId, { date }));
  }
});

test('leap dates and year-boundary dates are accepted when real', () => {
  for (const date of ['2028-02-29', '2026-12-31', '2027-01-01']) {
    assert.equal(editProposal(createDemoState(), directId, { date }).proposalsByRoom[directId].date, date);
  }
});

test('time validation rejects invalid clocks and non-string values', () => {
  for (const time of ['24:00', '14:60', '9:00', '오후 2시', '', null]) fails(() => editProposal(createDemoState(), directId, { time }));
});

test('end time must be after start time', () => {
  for (const endTime of ['14:00', '13:59']) fails(() => editProposal(createDemoState(), directId, { endTime }));
});

test('title and place are required; notes may be empty', () => {
  fails(() => editProposal(createDemoState(), directId, { title: '  ' }));
  fails(() => editProposal(createDemoState(), directId, { place: '' }));
  assert.equal(editProposal(createDemoState(), directId, { notes: '' }).proposalsByRoom[directId].notes, '');
});

test('overlong title, place and notes are rejected', () => {
  for (const patch of [{ title: '가'.repeat(81) }, { place: '가'.repeat(201) }, { notes: '가'.repeat(2001) }]) fails(() => editProposal(createDemoState(), directId, patch));
});

test('HTML-shaped appointment data stays data before and after confirmation', () => {
  const title = '<img src=x onerror=alert(1)>';
  const edited = editProposal(createDemoState(), directId, { title, place: '<script>alert(1)</script>' });
  const confirmed = confirmProposal(edited, directId);
  assert.equal(confirmed.promises.at(-1).title, title);
  assert.equal(confirmed.promises.at(-1).place, '<script>alert(1)</script>');
});

test('RSVP updates one participant without changing host confirmation or others', () => {
  const state = confirmedGroup();
  const next = setRSVP(state, confirmedId, 'minseo', 'going');
  assert.equal(getPromise(next).rsvp.minseo, 'going');
  assert.equal(getPromise(next).rsvp.hajun, 'pending');
  assert.equal(getPromise(next).rsvp.me, 'pending');
  assert.equal(getPromise(next).status, 'confirmed');
  assert.equal(getPromise(state).rsvp.minseo, 'pending');
});

test('all supported RSVP choices work and repeat responses add no history', () => {
  let state = confirmedGroup();
  for (const status of ['going', 'maybe', 'declined', 'pending']) {
    state = setRSVP(state, confirmedId, 'hajun', status);
    assert.equal(getPromise(state).rsvp.hajun, status);
    const repeated = setRSVP(state, confirmedId, 'hajun', status);
    assert.deepEqual(repeated, state);
  }
});

test('RSVP rejects outsiders, nonexistent promises and invalid status', () => {
  fails(() => setRSVP(confirmedGroup(), confirmedId, 'outsider', 'going'));
  fails(() => setRSVP(confirmedGroup(), 'missing', 'minseo', 'going'));
  fails(() => setRSVP(confirmedGroup(), confirmedId, 'minseo', 'confirmed'));
});

test('explicit promise update records history and requests fresh RSVP', () => {
  const state = setRSVP(confirmedGroup(), confirmedId, 'hajun', 'going');
  const next = updatePromise(state, confirmedId, { date: '2026-10-24', time: '15:00', endTime: '17:00' });
  assert.equal(getPromise(next).date, '2026-10-24');
  assert.equal(getPromise(next).rsvp.hajun, 'pending');
  assert.equal(getPromise(next).history.at(-1).type, 'updated');
  assert.equal(getPromise(state).date, '2026-10-17');
});

test('unchanged promise update preserves RSVP and history', () => {
  const state = setRSVP(confirmedGroup(), confirmedId, 'minseo', 'going');
  const next = updatePromise(state, confirmedId, { title: getPromise(state).title });
  assert.deepEqual(next, state);
});

test('promise patch cannot overwrite host, participants, RSVP, status or history', () => {
  for (const patch of [{ hostId: 'minseo' }, { participantIds: ['minseo'] }, { rsvp: { minseo: 'going' } }, { status: 'cancelled' }, { history: [] }]) fails(() => updatePromise(confirmedGroup(), confirmedId, patch));
});

test('promise update validates date, time and required fields before any change', () => {
  const state = confirmedGroup();
  for (const patch of [{ date: '2026-02-30' }, { time: '25:00' }, { title: '' }, { endTime: '00:00' }]) fails(() => updatePromise(state, confirmedId, patch));
  assert.equal(getPromise(state).date, '2026-10-17');
});

test('explicit cancellation changes only selected promise and records history', () => {
  const state = confirmedGroup();
  const next = cancelPromise(state, confirmedId);
  assert.equal(getPromise(next).status, 'cancelled');
  assert.equal(getPromise(next).history.at(-1).type, 'cancelled');
  assert.deepEqual(next.promises[0], state.promises[0]);
  assert.equal(getPromise(state).status, 'confirmed');
});

test('cancellation is idempotent', () => {
  const first = cancelPromise(confirmedGroup(), confirmedId);
  assert.deepEqual(cancelPromise(first, confirmedId), first);
});

test('cancelled appointment rejects edits and RSVP', () => {
  const state = cancelPromise(confirmedGroup(), confirmedId);
  fails(() => updatePromise(state, confirmedId, { title: '부활' }));
  fails(() => setRSVP(state, confirmedId, 'minseo', 'going'));
});

test('attendee cannot become host through appointment edits or authorize host-only actions', () => {
  const state = structuredClone(confirmedGroup());
  state.proposalsByRoom[directId].hostId = 'minseo';
  getPromise(state).hostId = 'minseo';
  fails(() => confirmProposal(state, directId));
  fails(() => updatePromise(state, confirmedId, { title: '참석자 변경' }));
  fails(() => cancelPromise(state, confirmedId));
});

test('unexpected candidate statuses cannot bypass confirmation', () => {
  const state = structuredClone(createDemoState());
  state.proposalsByRoom[directId].status = 'auto-confirmed';
  fails(() => confirmProposal(state, directId));
  fails(() => ignoreProposal(state, directId));
});

test('room return retains confirmed promise, RSVP and chat text', () => {
  let state = confirmedGroup();
  state = setRSVP(state, confirmedId, 'yujin', 'maybe');
  state = sendMessage(state, groupId, '약속 내용 확인했어요');
  state = selectRoom(state, directId);
  state = selectRoom(state, groupId);
  assert.equal(getPromise(state).rsvp.yujin, 'maybe');
  assert.equal(state.proposalsByRoom[groupId].status, 'confirmed');
  assert.equal(state.messagesByRoom[groupId].at(-1).text, '약속 내용 확인했어요');
});
