/**
 * Creator AI Proxy - Load Testing Script
 *
 * This script simulates high traffic to test the proxy's performance
 * and stability under load conditions.
 *
 * Usage:
 *   k6 run tests/load-testing.js
 *   k6 run tests/load-testing.js --out json=results.json
 *   k6 run tests/load-testing.js --env API_URL=https://your-function-url
 *
 * @requires k6 - Install with: brew install k6 (macOS) or apt install k6 (Linux)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const authLatency = new Trend('auth_latency');
const aiLatency = new Trend('ai_latency');
const taskLatency = new Trend('task_latency');
const successfulRequests = new Counter('successful_requests');
const failedRequests = new Counter('failed_requests');

// Configuration
const API_URL = __ENV.API_URL || 'https://europe-west1-creator-ai-proxy.cloudfunctions.net';
const TEST_LICENSE_KEY = __ENV.TEST_LICENSE_KEY || 'CREATOR-2024-LOADTEST-00001';

// Test options - Ramp up to 100 concurrent users
export const options = {
  stages: [
    { duration: '1m', target: 10 },    // Warm-up: ramp to 10 users
    { duration: '2m', target: 25 },    // Ramp up to 25 users
    { duration: '3m', target: 50 },    // Ramp up to 50 users
    { duration: '3m', target: 100 },   // Peak load: 100 users (~100 req/s)
    { duration: '2m', target: 100 },   // Sustain peak load
    { duration: '2m', target: 50 },    // Ramp down
    { duration: '1m', target: 0 },     // Cool down
  ],
  thresholds: {
    // Performance thresholds
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],  // 95% < 3s, 99% < 5s
    http_req_failed: ['rate<0.05'],                   // Error rate < 5%
    errors: ['rate<0.1'],                             // Custom error rate < 10%

    // Latency thresholds by endpoint
    auth_latency: ['p(95)<1000'],      // Auth endpoint < 1s
    ai_latency: ['p(95)<5000'],        // AI routing < 5s
    task_latency: ['p(95)<500'],       // Task status < 500ms
  },
  // Graceful stop
  gracefulRampDown: '30s',
};

// Request headers
const headers = {
  'Content-Type': 'application/json',
};

/**
 * Setup function - runs once before the test
 * Used to create test data and get authentication token
 */
export function setup() {
  console.log('Starting load test setup...');
  console.log(`API URL: ${API_URL}`);

  // Validate license and get site_token
  const authPayload = JSON.stringify({
    license_key: TEST_LICENSE_KEY,
    site_url: `https://loadtest-setup.example.com`,
  });

  const authRes = http.post(`${API_URL}/api/auth/validate-license`, authPayload, {
    headers,
    timeout: '30s',
  });

  if (authRes.status === 200) {
    const body = authRes.json();
    console.log(`Setup successful. Plan: ${body.plan}`);
    return {
      site_token: body.site_token,
      plan: body.plan,
    };
  } else {
    console.log(`Setup warning: Auth returned status ${authRes.status}`);
    return {
      site_token: null,
      plan: 'unknown',
    };
  }
}

/**
 * Main test function - runs for each virtual user
 */
export default function (data) {
  const vuId = __VU;  // Virtual User ID
  const iteration = __ITER;  // Iteration number

  // Test Group 1: License Validation
  group('License Validation', function () {
    testLicenseValidation(vuId);
  });

  // Test Group 2: AI Request Routing (only if we have a token)
  if (data && data.site_token) {
    group('AI Request Routing', function () {
      testAIRouting(data.site_token, vuId);
    });
  }

  // Test Group 3: Task Submission and Status
  if (data && data.site_token) {
    group('Async Tasks', function () {
      testAsyncTasks(data.site_token, vuId);
    });
  }

  // Random sleep between 0.5 and 2 seconds to simulate real user behavior
  sleep(Math.random() * 1.5 + 0.5);
}

/**
 * Test license validation endpoint
 */
function testLicenseValidation(vuId) {
  const payload = JSON.stringify({
    license_key: TEST_LICENSE_KEY,
    site_url: `https://loadtest-vu${vuId}.example.com`,
  });

  const startTime = Date.now();
  const res = http.post(`${API_URL}/api/auth/validate-license`, payload, {
    headers,
    timeout: '30s',
    tags: { endpoint: 'validate-license' },
  });
  const duration = Date.now() - startTime;

  authLatency.add(duration);

  const success = check(res, {
    'auth: status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'auth: response time < 2s': (r) => r.timings.duration < 2000,
    'auth: has valid response body': (r) => {
      try {
        const body = r.json();
        return body.success !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (success) {
    successfulRequests.add(1);
    errorRate.add(0);
  } else {
    failedRequests.add(1);
    errorRate.add(1);
    console.log(`Auth failed: status=${res.status}, body=${res.body}`);
  }
}

/**
 * Test AI request routing endpoint
 */
function testAIRouting(siteToken, vuId) {
  const taskTypes = ['TEXT_GEN', 'CODE_GEN', 'DESIGN_GEN', 'ECOMMERCE_GEN'];
  const randomTaskType = taskTypes[Math.floor(Math.random() * taskTypes.length)];

  const prompts = {
    TEXT_GEN: 'Scrivi un breve paragrafo sui benefici del SEO per le piccole imprese.',
    CODE_GEN: 'Scrivi una funzione TypeScript che valida un indirizzo email.',
    DESIGN_GEN: 'Descrivi un layout hero section moderno per un sito e-commerce.',
    ECOMMERCE_GEN: 'Scrivi una descrizione prodotto per uno smartphone di fascia media.',
  };

  const payload = JSON.stringify({
    task_type: randomTaskType,
    prompt: prompts[randomTaskType],
    context: {
      site_title: `LoadTest Site ${vuId}`,
      theme: 'twentytwentythree',
      load_test: true,
    },
  });

  const startTime = Date.now();
  const res = http.post(`${API_URL}/api/ai/route-request`, payload, {
    headers: {
      ...headers,
      'Authorization': `Bearer ${siteToken}`,
    },
    timeout: '60s',
    tags: { endpoint: 'route-request', task_type: randomTaskType },
  });
  const duration = Date.now() - startTime;

  aiLatency.add(duration);

  const success = check(res, {
    'ai: status is 200 or 429 or 503': (r) => [200, 429, 503].includes(r.status),
    'ai: response time < 30s': (r) => r.timings.duration < 30000,
    'ai: has content or error message': (r) => {
      try {
        const body = r.json();
        return body.content !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (success && res.status === 200) {
    successfulRequests.add(1);
    errorRate.add(0);
  } else {
    failedRequests.add(1);
    errorRate.add(res.status !== 429 ? 1 : 0);  // Don't count rate limits as errors
    if (res.status !== 429) {
      console.log(`AI routing failed: status=${res.status}, task=${randomTaskType}`);
    }
  }
}

/**
 * Test async task submission and status polling
 */
function testAsyncTasks(siteToken, vuId) {
  // Submit a task
  const submitPayload = JSON.stringify({
    task_type: 'bulk_articles',
    task_data: {
      topics: ['Load Test Topic 1', 'Load Test Topic 2'],
      tone: 'professional',
      language: 'it',
      load_test: true,
    },
  });

  const submitRes = http.post(`${API_URL}/api/tasks/submit`, submitPayload, {
    headers: {
      ...headers,
      'Authorization': `Bearer ${siteToken}`,
    },
    timeout: '30s',
    tags: { endpoint: 'task-submit' },
  });

  const submitSuccess = check(submitRes, {
    'task submit: status is 202 or 429': (r) => r.status === 202 || r.status === 429,
    'task submit: has job_id': (r) => {
      try {
        const body = r.json();
        return body.job_id !== undefined || body.error !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!submitSuccess || submitRes.status !== 202) {
    return;
  }

  const submitBody = submitRes.json();
  const jobId = submitBody.job_id;

  // Poll task status (3 times with 1 second interval)
  for (let i = 0; i < 3; i++) {
    sleep(1);

    const startTime = Date.now();
    const statusRes = http.get(`${API_URL}/api/tasks/status/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${siteToken}`,
      },
      timeout: '10s',
      tags: { endpoint: 'task-status' },
    });
    const duration = Date.now() - startTime;

    taskLatency.add(duration);

    const statusSuccess = check(statusRes, {
      'task status: status is 200': (r) => r.status === 200,
      'task status: response time < 1s': (r) => r.timings.duration < 1000,
      'task status: has status field': (r) => {
        try {
          const body = r.json();
          return body.status !== undefined;
        } catch {
          return false;
        }
      },
    });

    if (statusSuccess) {
      const body = statusRes.json();
      if (body.status === 'completed' || body.status === 'failed') {
        break;
      }
    }
  }
}

/**
 * Teardown function - runs once after all tests complete
 */
export function teardown(data) {
  console.log('Load test completed.');
  console.log('Review the results above for performance insights.');
}

/**
 * Handle summary - custom summary output
 */
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-summary.json': JSON.stringify(data, null, 2),
  };
}

/**
 * Generate text summary
 */
function textSummary(data, options) {
  const lines = [];

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('  CREATOR AI PROXY - LOAD TEST SUMMARY');
  lines.push('='.repeat(60));
  lines.push('');

  // Duration info
  const duration = data.state.testRunDurationMs;
  lines.push(`  Total Duration: ${(duration / 1000).toFixed(1)}s`);
  lines.push(`  Virtual Users Peak: ${data.metrics.vus_max ? data.metrics.vus_max.values.max : 'N/A'}`);
  lines.push('');

  // Request metrics
  lines.push('  HTTP REQUESTS');
  lines.push('  ' + '-'.repeat(40));
  const reqCount = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  const reqRate = data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0;
  lines.push(`  Total Requests: ${reqCount}`);
  lines.push(`  Requests/sec: ${reqRate.toFixed(2)}`);
  lines.push('');

  // Latency
  lines.push('  LATENCY (ms)');
  lines.push('  ' + '-'.repeat(40));
  const httpDur = data.metrics.http_req_duration;
  if (httpDur) {
    lines.push(`  Avg: ${httpDur.values.avg.toFixed(2)}`);
    lines.push(`  P95: ${httpDur.values['p(95)'].toFixed(2)}`);
    lines.push(`  P99: ${httpDur.values['p(99)'].toFixed(2)}`);
    lines.push(`  Max: ${httpDur.values.max.toFixed(2)}`);
  }
  lines.push('');

  // Errors
  lines.push('  ERROR RATE');
  lines.push('  ' + '-'.repeat(40));
  const failRate = data.metrics.http_req_failed;
  if (failRate) {
    const pct = (failRate.values.rate * 100).toFixed(2);
    lines.push(`  Failed Requests: ${pct}%`);
  }
  lines.push('');

  // Thresholds
  lines.push('  THRESHOLDS');
  lines.push('  ' + '-'.repeat(40));
  if (data.thresholds) {
    for (const [name, threshold] of Object.entries(data.thresholds)) {
      const status = threshold.ok ? 'PASS' : 'FAIL';
      lines.push(`  ${name}: ${status}`);
    }
  }
  lines.push('');
  lines.push('='.repeat(60));

  return lines.join('\n');
}
