/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@api/(.*)$': '<rootDir>/src/api/$1',
    '^@providers/(.*)$': '<rootDir>/src/providers/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1'
  },
  modulePaths: ['<rootDir>/src'],
  collectCoverageFrom: [
    // Only collect coverage from files that have corresponding tests (not mocked)
    'src/services/modelService.ts',
    'src/services/licensing.ts',
    'src/middleware/auth.ts',
    'src/middleware/rateLimit.ts',
    'src/providers/claude.ts',
    'src/providers/gemini.ts',
    'src/types/AIProvider.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50
    },
    './src/services/modelService.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    },
    './src/services/licensing.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    },
    './src/middleware/auth.ts': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    }
  },
  verbose: true,
  testTimeout: 30000,
  clearMocks: true,
  restoreMocks: true
};
