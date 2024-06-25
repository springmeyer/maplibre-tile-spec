#!/usr/bin/env node

import { MltDecoder, TileSetMetadata } from '../src/index';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { readFileSync, existsSync } from "fs";
import * as benchmark from 'benchmark';
import { execSync } from "child_process";
import { assert } from 'console';


const args = process.argv.slice(2);

const tiles = [
  'bing/4-8-5',
  'bing/4-12-6',
  'bing/4-13-6',
  'bing/5-15-10',
  'bing/5-16-11',
  'bing/5-16-9',
  'bing/5-17-10',
  'bing/5-17-11',
];

if (args.includes('--one')) {
  tiles.length = 1;
}

if (!existsSync('../java/build/libs/encode.jar')) {
  console.log('encode.jar does not exist, building java project...');
  execSync('./gradlew cli', { cwd: '../java' });
}
tiles.forEach(tile => {
  if (!existsSync(`../test/expected/${tile}.mlt.meta.pbf`)) {
    console.log('Generating MLT tiles & metadata');
    const cmd = `java -jar ../java/build/libs/encode.jar -mvt ../test/fixtures/${tile}.mvt -metadata -decode -mlt ../test/expected/${tile}.mlt`;
    console.log(cmd)
    execSync(cmd);
  }
});

const willValidate = args.includes('--validate');
const willRunMLT = args.includes('--mlt');
const willRunMVT = args.includes('--mvt');
const willRunMLTJSON = args.includes('--mltjson');
const willRunMVTJSON = args.includes('--mvtjson');
if (!willRunMLT && !willRunMVT && !willRunMLTJSON && !willRunMVTJSON) {
  console.error("Please provide at least one of --mlt, --mltjson, --mvt, or --mvtjson flags to run benchmarks.");
  process.exit(1);
}

let minTime = 10;
let maxTime = 20;
const IN_LOOP_ITERATIONS = 5;
if (process.env.GITHUB_RUN_ID) {
  maxTime = 2;
  console.log(`Running in CI, using smaller maxTime: ${maxTime} seconds`);
}

const load = (tile : String) => {
  const metadata: Buffer = readFileSync(`../test/expected/${tile}.mlt.meta.pbf`);
  const mvtTile: Buffer = readFileSync(`../test/fixtures/${tile}.mvt`);
  const mltTile: Buffer = readFileSync(`../test/expected/${tile}.mlt`);
  const uri = tile.split('/')[1].split('-').map(Number);
  const { z, x, y } = { z: uri[0], x: uri[1], y: uri[2] };
  const tableMeta = TileSetMetadata.fromBinary(metadata);
  return { tile, x, y, z, mltTile, mvtTile, tableMeta };
}

const validate = async (input : any) => {
  return new Promise((resolve) => {
    const decoded = MltDecoder.decodeMlTile(input.mltTile, input.tableMeta);
    const mvtDecoded = new VectorTile(new Protobuf(input.mvtTile));
    const layerNames = Object.keys(decoded.layers).sort();
    let count = 0;
    for (const layerName of layerNames) {
      const layer = decoded.layers[layerName];
      const mvtLayer = mvtDecoded.layers[layerName];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const mvtFeature = mvtLayer.feature(i);
        const featureKeys = Object.keys(feature.properties).sort();
        const mvtFeatureKeys = Object.keys(mvtFeature.properties).sort();
        // workaround https://github.com/maplibre/maplibre-tile-spec/issues/181
        if (mvtFeatureKeys.indexOf('id') !== -1) {
          mvtFeatureKeys.splice(mvtFeatureKeys.indexOf('id'), 1);
        }
        assert(featureKeys.length === mvtFeatureKeys.length, `Feature keys mismatch for ${input.tile}`);
        const featureKeysStr = JSON.stringify(featureKeys);
        const mvtFeatureKeysStr = JSON.stringify(mvtFeatureKeys);
        if (featureKeysStr !== mvtFeatureKeysStr) {
          console.error(`Validation failed for ${input.tile} ${i}`);
          console.log(featureKeysStr);
          console.log('  vs')
          console.log(mvtFeatureKeysStr);
          process.exit(1);
        }
        const json = feature.toGeoJSON(input.x, input.y, input.z);
        const mvtJson = mvtFeature.toGeoJSON(input.x, input.y, input.z);
        assert(json.geometry.type === mvtJson.geometry.type, `Geometry type mismatch for ${input.tile} ${i}`);
      }
      count++;
    }
    assert(count > 0, `Validation count mismatch for ${input.tile}`)
    resolve(null);
  })
}

const runSuite = async (input: any) => {
  return new Promise((resolve) => {
      const tile = input.tile;
      const suite = new benchmark.Suite;
      suite.on('cycle', function(event: Event) {
        console.log(String(event.target));
      })
      if (willRunMVT) {
        let opts : null | number = null;
        suite
          .add(`MVT -> loadGeo ${tile}`, {
            defer: true,
            minTime: minTime,
            maxTime: maxTime,
            fn: (deferred: benchmark.Deferred) => {
                for (let i = 0; i < IN_LOOP_ITERATIONS; i++) {
                  const decoded = new VectorTile(new Protobuf(input.mvtTile));
                  let count = 0;
                  const layerNames = Object.keys(decoded.layers).sort();
                  for (const layerName of layerNames) {
                    const layer = decoded.layers[layerName];
                    for (let j = 0; j < layer.length; j++) {
                      const feature = layer.feature(j);
                      const result = feature.loadGeometry();
                      count++;
                    }
                  }
                  if (opts === null) {
                    opts = count;
                  } else {
                    if (count !== opts || count < 1) {
                      console.error(`Feature count mismatch for ${tile}`);
                      process.exit(1);
                    }
                  }
                }
                deferred.resolve();
            }
          }).
          on('complete', () => {
            console.log(`  Total MVT features(loadGeometry) processed: ${opts}`);
            resolve(null);
          });
      }
      if (willRunMLT) {
        let opts : null | number = null;
        suite
          .add(`MLT -> loadGeo ${tile}`, {
            defer: true,
            minTime: minTime,
            maxTime: maxTime,
            fn: (deferred: benchmark.Deferred) => {
              for (let i = 0; i < IN_LOOP_ITERATIONS; i++) {
                const decoded = MltDecoder.decodeMlTile(input.mltTile, input.tableMeta);
                let count = 0;
                const layerNames = Object.keys(decoded.layers).sort();
                for (const layerName of layerNames) {
                  const layer = decoded.layers[layerName];
                  for (let j = 0; j < layer.length; j++) {
                    const feature = layer.feature(j);
                    const result = feature.loadGeometry();
                    count++;
                  }
                }
                if (opts === null) {
                  opts = count;
                } else {
                  if (count !== opts || count < 1) {
                    console.error(`Feature count mismatch for ${tile}`);
                    process.exit(1);
                  }
                }
              }
              deferred.resolve();
            }
          }).
          on('complete', () => {
            console.log(`  Total MLT features(loadGeometry) processed: ${opts}`);
            resolve(null);
          });
      }
      if (willRunMVTJSON) {
        let opts : null | number = null;
        suite
          .add(`MVT -> GeoJSON ${tile}`, {
            defer: true,
            minTime: minTime,
            maxTime: maxTime,
            fn: (deferred: benchmark.Deferred) => {
                for (let i = 0; i < IN_LOOP_ITERATIONS; i++) {
                  const decoded = new VectorTile(new Protobuf(input.mvtTile));
                  let count = 0;
                  const layerNames = Object.keys(decoded.layers).sort();
                  for (const layerName of layerNames) {
                    const layer = decoded.layers[layerName];
                    for (let j = 0; j < layer.length; j++) {
                      const feature = layer.feature(j);
                      const result = feature.toGeoJSON(input.x, input.y, input.z);
                      count++;
                    }
                  }
                  if (opts === null) {
                    opts = count;
                  } else {
                    if (count !== opts || count < 1) {
                      console.error(`Feature count mismatch for ${tile}`);
                      process.exit(1);
                    }
                  }
                }
                deferred.resolve();
          }
          }).
          on('complete', () => {
            console.log(`  Total MVT features(json) processed: ${opts}`);
            resolve(null);
          });
      }
      if (willRunMLTJSON) {
        let opts : null | number = null;
        suite
          .add(`MLT -> GeoJSON ${tile}`, {
              defer: true,
              minTime: minTime,
              maxTime: maxTime,
              fn: (deferred: benchmark.Deferred) => {
                  for (let i = 0; i < IN_LOOP_ITERATIONS; i++) {
                    const decoded = MltDecoder.decodeMlTile(input.mltTile, input.tableMeta);
                    let count = 0;
                    const layerNames = Object.keys(decoded.layers).sort();
                    for (const layerName of layerNames) {
                      const layer = decoded.layers[layerName];
                      for (let j = 0; j < layer.length; j++) {
                        const feature = layer.feature(j);
                        const result = feature.toGeoJSON(input.x, input.y, input.z);
                        count++;
                      }
                    }
                    if (opts === null) {
                      opts = count;
                    } else {
                      if (count !== opts || count < 1) {
                        console.error(`Feature count mismatch for ${tile}`);
                        process.exit(1);
                      }
                    }
                  }
                  deferred.resolve();
              }
          }).
          on('complete', () => {
            console.log(`  Total MLT features(json) processed: ${opts}`);
            resolve(null);
          });
      }
      suite.run({ async: true });
  })
}

const runSuites = async (tiles: any) => {
  const inputs = [];
  for (const tile of tiles) {
      inputs.push(load(tile));
  }
  if (willValidate) {
    for (const input of inputs) {
      console.log(`Validating result for ${input.tile}`);
      await validate(input);
      console.log(` ✔ passed for ${input.tile}`);
    }
  }
  for (const input of inputs) {
    console.log(`Running benchmarks for ${input.tile}`);
    await runSuite(input);
  }
}

runSuites(tiles);
