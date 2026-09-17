import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import {
  shouldVisitUrl,
  isProhibitedAddress,
  assertPublicHttpUrl,
} from '../dist/security/url-policy.js';

test('domain policy permits reviewed URLs that pass path filters', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/companies/acme', ['/companies/'], ['/private/'], {
      blocked: false,
      tos_review_status: 'permitted',
    }),
    true,
  );
});

test('domain policy fails closed for administratively blocked domains', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/', [], [], {
      blocked: true,
      tos_review_status: 'permitted',
    }),
    false,
  );
});

test('domain policy fails closed when terms prohibit crawling', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/', [], [], {
      blocked: false,
      tos_review_status: 'prohibited',
    }),
    false,
  );
});

test('path exclusions still deny URLs under a licensed domain policy', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/private/report', [], ['/private/'], {
      blocked: false,
      tos_review_status: 'licensed',
    }),
    false,
  );
});

for (const address of [
  '0:0:0:0:0:0:0:1',
  '0:0:0:0:0:0:0:0',
  'ff02::1',
  'ff0e::1',
  '192.0.2.1',
  'fe80::1%eth0',
  '2606:4700:4700::1111%eth0',
]) {
  test(`URL policy rejects non-public address ${address}`, () => {
    assert.equal(isProhibitedAddress(address), true);
  });
}

test('IPv4-mapped IPv6 addresses retain the embedded IPv4 policy', () => {
  assert.equal(isProhibitedAddress('::ffff:7f00:1'), true);
  assert.equal(isProhibitedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isProhibitedAddress('::ffff:5db8:d822'), false);
});

test('literal IPv6 destinations are checked without DNS resolution', async (t) => {
  const lookup = t.mock.method(dns, 'lookup', async () => {
    throw new Error('unexpected DNS lookup');
  });
  assert.equal(
    (await assertPublicHttpUrl('https://[2606:4700:4700::1111]/')).hostname,
    '[2606:4700:4700::1111]',
  );
  await assert.rejects(assertPublicHttpUrl('http://[::1]/'), /private_destination_rejected/);
  await assert.rejects(assertPublicHttpUrl('http://[ff02::1]/'), /private_destination_rejected/);
  assert.equal(lookup.mock.callCount(), 0);
});
