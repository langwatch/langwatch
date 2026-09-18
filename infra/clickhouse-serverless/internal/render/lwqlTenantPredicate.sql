{tenantColumn} IN (SELECT any({tenantId}) FROM {keyMap} WHERE has(splitByChar(',', getSetting('{tenantSetting}')), {keyHash}) GROUP BY {keyHash} HAVING uniqExact({tenantId}) = 1)
