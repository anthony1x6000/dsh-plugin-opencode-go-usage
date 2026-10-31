// Offline contract for the composer-dock gate: the OpenCode Go meter is only
// mounted while the Session's active model is `opencode-go`. Hidden must mean
// unmounted, so the meter's polling effect tears down and an open card closes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Minimal React surface the dock bundle touches; hooks never run effects. */
function fakeReact() {
  const Fragment = Symbol('Fragment');
  return {
    Fragment,
    createElement(type, props, ...children) {
      const value = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
      return { type, props: { ...(props ?? {}), ...(value === undefined ? {} : { children: value }) } };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useCallback(fn) {
      return fn;
    },
    useRef(initial) {
      return { current: initial ?? null };
    },
  };
}

/** Execute the browser bundle in a fake DOM and return its cordis plugin face. */
function loadClient() {
  let registration;
  const styleTags = [];
  const fetches = [];
  const fakeDocument = {
    documentElement: { lang: 'en' },
    body: {},
    head: { appendChild() {} },
    createElement() {
      const tag = { dataset: {}, textContent: '', remove() {} };
      styleTags.push(tag);
      return tag;
    },
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value;
        },
      },
    },
    document: fakeDocument,
    navigator: { language: 'en' },
    fetch: (...args) => {
      fetches.push(args);
      throw new Error('the hidden meter must not fetch');
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  assert.ok(registration, 'bundle must register through __ModuleLoader__.load');
  assert.equal(registration.id, 'dsh-plugin-opencode-go-usage', 'registration id must equal the package name');

  const React = fakeReact();
  const ReactDOM = { createPortal: (node) => ({ portal: node }) };
  const exported = registration.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react-dom') return ReactDOM;
    throw new Error(`unexpected module: ${id}`);
  });

  const registered = [];
  const ctx = {
    get: () => undefined,
    effect: () => {},
    slots: {
      inject(name, build) {
        assert.equal(name, 'conversation.composer.dock');
        registered.push(build());
      },
      register(entry, Component) {
        return { entry, Component };
      },
    },
  };
  exported.apply(ctx);
  assert.equal(registered.length, 1, 'the bundle must register exactly one dock entry');

  return { exported, registration, entry: registered[0], fetches, styleTags };
}

const selection = (provider, model = 'deepseek-v4.1-flash') => ({ provider, model });

test('only opencode-go selections count', () => {
  const { exported } = loadClient();
  const usesOpenCode = exported.selectionUsesOpenCode;
  assert.equal(typeof usesOpenCode, 'function', 'the gate predicate must be exported for offline checks');

  assert.equal(usesOpenCode(undefined), false, 'absent projection is not a selection');
  assert.equal(usesOpenCode(null), false, 'null projection is not a selection');
  assert.equal(usesOpenCode({ next: null, lastUsed: null }), false, 'empty selection hides');

  assert.equal(usesOpenCode({ next: selection('opencode-go') }), true, 'pending opencode-go selection shows');
  assert.equal(usesOpenCode({ next: null, lastUsed: selection('opencode-go') }), true, 'last used opencode-go shows');
  assert.equal(usesOpenCode({ next: selection('opencode-go'), lastUsed: selection('deepseek') }), true, 'new opencode-go pick shows before its first turn');

  assert.equal(usesOpenCode({ next: selection('deepseek') }), false, 'another pending provider hides');
  assert.equal(usesOpenCode({ next: selection('claude-code') }), false, 'claude-code hides');
  assert.equal(usesOpenCode({ next: selection('opencode') }), false, 'only the opencode-go provider counts');
  assert.equal(usesOpenCode({ next: selection('OPENCODE-GO') }), false, 'provider ids compare exactly');
  assert.equal(
    usesOpenCode({ next: selection('claude-code'), lastUsed: selection('opencode-go') }),
    false,
    'a pending switch away hides before its first turn',
  );
});

test('hidden selections unmount the meter, so polling and any open card stop', () => {
  const { entry } = loadClient();
  const Gate = entry.Component;
  assert.equal(typeof Gate, 'function', 'the dock entry must be a component');

  const seenKeys = [];
  const useProjection = (key) => {
    seenKeys.push(key);
    return { next: selection('deepseek') };
  };
  const hidden = Gate({ useProjection, t: (key) => key });
  assert.equal(hidden, null, 'a non-opencode session renders nothing');
  assert.deepEqual(seenKeys, ['modelSelection'], 'the gate reads the model-selection projection');

  const noProjection = Gate({ useProjection: () => undefined, t: (key) => key });
  assert.equal(noProjection, null, 'a missing projection cannot prove the model, so it hides');
});

test('an opencode-go session renders the meter in the composer dock', () => {
  const { entry, fetches } = loadClient();
  const Gate = entry.Component;
  const useProjection = () => ({ next: selection('opencode-go') });
  const mounted = Gate({ useProjection, t: (key) => key });
  assert.ok(mounted, 'an opencode-go session mounts the meter');
  assert.equal(typeof mounted.type, 'function', 'the gate mounts the meter component');

  const tree = mounted.type(mounted.props);
  const anchor = findNode(tree, (node) => node?.props?.['data-composer-stat'] === 'opencode-go');
  assert.ok(anchor, 'the rendered meter carries the composer dock marker');
  assert.equal(fetches.length, 0, 'effects (and therefore polling) only run after React commits');
});

test('the dock entry keeps its registration contract', () => {
  const { entry } = loadClient();
  assert.equal(entry.entry.name, 'conversation.composer.dock');
  assert.equal(entry.entry.id, 'opencode-go-usage');
  assert.equal(entry.entry.order, 2);
  assert.equal(entry.entry.locale, 'opencode-go-usage');
});

/** Depth-first search over the small React element tree. */
function findNode(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  return findNode(node.props?.children, predicate);
}
