// ATF Test: SAGEBRUSHDataMasker
// Test Suite: SAGEBRUSH_ATF_Suite
// Test Name: DataMasker_strips_PII

var masker = new SAGEBRUSHDataMasker();

var input = {
    email: 'john.doe@company.com',
    phone: '+61-2-9999-8888',
    first_name: 'John',
    last_name: 'Doe',
    employee_id: 'EMP-001234',
    department: 'IT Operations',
    incident_count: 42
};

var result = masker.mask(input);

// PII fields must be replaced with tokens
gs.assertTrue(result.maskedData.email !== 'john.doe@company.com', 'email must be masked');
gs.assertTrue(result.maskedData.phone !== '+61-2-9999-8888', 'phone must be masked');
gs.assertTrue(result.maskedData.first_name !== 'John', 'first_name must be masked');
gs.assertTrue(result.maskedData.last_name !== 'Doe', 'last_name must be masked');
gs.assertTrue(result.maskedData.employee_id !== 'EMP-001234', 'employee_id must be masked');

// Non-PII fields must be preserved
gs.assertTrue(result.maskedData.department === 'IT Operations', 'department should be preserved');
gs.assertTrue(result.maskedData.incident_count === 42, 'numeric fields should be preserved');

// Token map must allow reversibility
gs.assertTrue(result.tokenMap !== null, 'tokenMap should exist');
gs.assertTrue(typeof result.tokenMap === 'object', 'tokenMap should be an object');
gs.assertTrue(result.tokenMap['[EMAIL_1]'] === 'john.doe@company.com', 'tokenMap must preserve original email for reversibility');
