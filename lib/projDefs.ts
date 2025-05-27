import proj4 from 'proj4';

try {
  // Define EPSG:23030 (ED50 / UTM zone 30N) as required by the Catastro service
  proj4.defs(
    'EPSG:23030',
    '+proj=utm +zone=30 +ellps=intl +units=m +no_defs +towgs84=-87,-98,-121,0,0,0,0'
  );
} catch (error) {
  console.error("Error defining custom projection EPSG:23030 with proj4:", error);
  // Depending on how critical this is, you might want to throw the error
  // or allow the app to continue with a degraded state if possible.
  // For now, logging it will help in diagnosis.
}
