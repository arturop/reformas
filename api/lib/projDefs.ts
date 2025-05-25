import proj4 from 'proj4';

// Define EPSG:23030 (ED50 / UTM zone 30N) as required by the Catastro service
proj4.defs(
  'EPSG:23030',
  '+proj=utm +zone=30 +ellps=intl +units=m +no_defs +towgs84=-87,-98,-121,0,0,0,0'
);