export const CONTRACTOR_DIRECTORY = [
  {
    id: 'prolintas',
    name: 'Projek Lintasan Kota Holdings (PROLINTAS)',
    type: 'Expressway operator',
    coverage: 'Klang Valley',
    email: 'dispatch@prolintas.sim.local',
    phone: '+60 3-5523 8800',
    contactPerson: 'Operations Control Desk',
    domainHints: ['prolintas', 'prolintas.com.my']
  },
  {
    id: 'plus',
    name: 'PLUS Malaysia Berhad',
    type: 'Expressway operator',
    coverage: 'North-South corridor',
    email: 'operations@plus.sim.local',
    phone: '+60 3-7494 3333',
    contactPerson: 'Expressway Maintenance Unit',
    domainHints: ['plus', 'plus.com.my']
  },
  {
    id: 'besraya',
    name: 'BESRAYA (Besraya Sdn Bhd)',
    type: 'Urban expressway operator',
    coverage: 'Kuala Lumpur / Seri Kembangan',
    email: 'maintenance@besraya.sim.local',
    phone: '+60 3-9544 5577',
    contactPerson: 'Asset & Repair Coordinator',
    domainHints: ['besraya']
  },
  {
    id: 'kesas',
    name: 'KESAS Sdn Bhd',
    type: 'Urban expressway operator',
    coverage: 'Shah Alam / Klang Valley',
    email: 'roadworks@kesas.sim.local',
    phone: '+60 3-5635 8888',
    contactPerson: 'Road Safety & Maintenance Desk',
    domainHints: ['kesas']
  },
  {
    id: 'sprint',
    name: 'Sistem Penyuraian Trafik KL Barat (SPRINT)',
    type: 'Urban expressway operator',
    coverage: 'Kuala Lumpur',
    email: 'ops@sprint.sim.local',
    phone: '+60 3-7729 6888',
    contactPerson: 'Network Maintenance Desk',
    domainHints: ['sprint']
  },
  {
    id: 'ijm',
    name: 'IJM Corporation Berhad',
    type: 'Construction and infrastructure',
    coverage: 'Nationwide projects',
    email: 'infra@ijm.sim.local',
    phone: '+60 3-8026 9999',
    contactPerson: 'Infrastructure Support Team',
    domainHints: ['ijm', 'ijm.com']
  },
  {
    id: 'gamuda',
    name: 'Gamuda Berhad',
    type: 'Construction and engineering',
    coverage: 'Nationwide projects',
    email: 'engineering@gamuda.sim.local',
    phone: '+60 3-7495 6888',
    contactPerson: 'Civil Works Desk',
    domainHints: ['gamuda', 'gamuda.com.my']
  },
  {
    id: 'sunway',
    name: 'Sunway Construction Group Berhad',
    type: 'Construction contractor',
    coverage: 'Nationwide projects',
    email: 'projects@sunwayconstruction.sim.local',
    phone: '+60 3-5626 8000',
    contactPerson: 'Project Delivery Unit',
    domainHints: ['sunway', 'sunwayconstruction']
  },
  {
    id: 'mrcb',
    name: 'Malaysian Resources Corporation Berhad (MRCB)',
    type: 'Infrastructure developer',
    coverage: 'Urban infrastructure',
    email: 'maintenance@mrcb.sim.local',
    phone: '+60 3-2786 8888',
    contactPerson: 'Urban Infrastructure Team',
    domainHints: ['mrcb']
  },
  {
    id: 'edgenta',
    name: 'UEM Edgenta Berhad',
    type: 'Asset and infrastructure services',
    coverage: 'Nationwide operations',
    email: 'repairs@edgenta.sim.local',
    phone: '+60 3-7846 8888',
    contactPerson: 'Operations Coordination Centre',
    domainHints: ['edgenta', 'uem']
  }
];

export const CONTRACTOR_DIRECTORY_BY_ID = Object.fromEntries(CONTRACTOR_DIRECTORY.map((org) => [org.id, org]));
