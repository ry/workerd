// Copyright (c) 2023 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// We want to test the behavior of the Durable Object stub now that it uses name interception to
// behave like a JS Proxy object.
import * as assert from 'node:assert';

export class DurableObjectExample {
  constructor() {
    this.check = true;
  }

  async fetch(request) {
    return new Response('OK');
  }

  async foo() {
    // Server side impl of foo.
    return 'foo from remote';
  }

  async throw() {
    throw 1;
  }

  thisCheck() {
    if (this.check !== true) {
      throw new Error('incorrect this within rpc function call');
    }
    return true;
  }
}

async function checkDurableObject(obj) {
  assert.equal(await obj.foo(), 'foo from remote');
  assert.equal(await obj.thisCheck(), true);
  assert.deepStrictEqual(await obj.fetch('http://foo/'), new Response('OK'));
  assert.rejects(obj.throw());
}

function checkNullishJurisdiction(env, jurisdiction) {
  const id1 = env.ns.jurisdiction(jurisdiction).newUniqueId();
  const stub1 = env.ns.get(id1);
  checkDurableObject(stub1);
  const id2 = env.ns.newUniqueId({ jurisdiction });
  const stub2 = env.ns.get(id2);
  checkDurableObject(stub2);
}

export default {
  async test(_request, env, ctx) {
    // This test verifies we can still use registered methods like `fetch()`, and also confirms that
    // dynamic names (foo() in this case) can also be called.
    //
    // We should still be able to define names on the stub in JS and get the expected result.

    // Check properties of DurableObjectId.
    const id = env.ns.idFromName('foo');
    assert.equal(id.name, 'foo');
    assert.equal(id.jurisdiction, undefined);

    {
      // Check that no two DurableObjectId created via `newUniqueId()` are equal.
      const id1 = env.ns.newUniqueId();
      const id2 = env.ns.newUniqueId();
      assert.equal(!id1.equals(id2), true);
    }

    // Check round tripping of DurableObjectId to string.
    //
    // Note: `name` property is dropped from `env.ns.idFromString(id.toString())`
    assert.equal(env.ns.idFromString(id.toString()).toString(), id.toString());

    // Check properties of DurableObject.
    let obj = env.ns.get(id);
    assert.equal(Object.keys(obj).length, 2);
    assert.equal(obj.name, 'foo');
    assert.equal(obj.id, id);
    assert.equal(obj.id.name, 'foo');
    assert.equal(obj.id.jurisdiction, undefined);

    // Check that we can call methods on a DurableObject.
    checkDurableObject(obj);

    {
      // Check that DurableObject constructed with `locationHint` is equivalent to `obj`.
      let otherObj = env.ns.get(id, { locationHint: 'wnam' });
      assert.deepStrictEqual(obj, otherObj);
      checkDurableObject(otherObj);
    }

    {
      // Check that DurableObject constructed via `getByName()` is equivalent to `obj`.
      let otherObj = env.ns.getByName('foo');
      assert.deepStrictEqual(obj, otherObj);
      checkDurableObject(otherObj);
    }

    {
      // Check that DurableObject constructed with `locationHint` and `getByName()` is equivalent
      // to `obj`.
      let otherObj = env.ns.getByName('foo', { locationHint: 'wnam' });
      assert.deepStrictEqual(obj, otherObj);
      checkDurableObject(otherObj);
    }

    {
      // Check that stubs accept a retry policy from both env bindings and ctx.exports, and that
      // non-numbers and values outside the limits are rejected.
      const retry = { maxRetries: 2, timeoutMs: 1000 };
      for (const ns of [env.ns, ctx.exports.DurableObjectExample]) {
        const otherObj = ns.get(ns.idFromName('foo'), { retry });
        assert.equal(otherObj.name, 'foo');
        assert.equal(await otherObj.foo(), 'foo from remote');
        assert.equal(
          await ns.getByName('foo', { retry: {} }).foo(),
          'foo from remote'
        );

        for (const maxRetries of [-1, 1.5, 10.5, 11]) {
          assert.throws(() => ns.get(id, { retry: { maxRetries } }), {
            name: 'RangeError',
            message: 'retry.maxRetries must be an integer between 0 and 10',
          });
        }
        for (const timeoutMs of [499, 1000.5, 60000.5, 60001]) {
          assert.throws(() => ns.get(id, { retry: { timeoutMs } }), {
            name: 'RangeError',
            message: 'retry.timeoutMs must be an integer between 500 and 60000',
          });
        }
        for (const value of [null, '5', true]) {
          assert.throws(() => ns.get(id, { retry: { maxRetries: value } }), {
            name: 'TypeError',
          });
          assert.throws(() => ns.get(id, { retry: { timeoutMs: value } }), {
            name: 'TypeError',
          });
        }
      }
    }

    {
      // Check that nullish jurisdictions work in Workerd
      checkNullishJurisdiction(env, null);
      checkNullishJurisdiction(env, undefined);
    }

    // Check that methods can be defined on DurableObject and are callable.
    obj.baz = () => {
      return 'called baz';
    };
    assert.equal(Object.keys(obj).length, 3);
    assert.equal(typeof obj.baz, 'function');
    assert.equal(obj.baz(), 'called baz');

    return new Response('OK');
  },
};
