import { project } from './Projection';

export class Feature {
    id: number;
    geometry;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    properties: { [key: string]: any };
    constructor(id: number, geometry, properties: { [key: string]: any }) {
        this.id = id;
        this.geometry = geometry;
        this.properties = properties;
    }

    public loadGeometry = () => {
        if (typeof this.geometry.loadGeometry === 'function') {
            return this.geometry.loadGeometry();
        } else {
            return [[this.geometry]];
        }
    }

    public toGeoJSON = (x: number, y: number, z: number) => {
        let geometry;
        if (typeof this.geometry.toGeoJSON === 'function') {
            geometry = this.geometry.toGeoJSON(x, y, z);
        } else {
            const projected = project(x, y, z, [this.geometry]);
            geometry = {
                "type": "Point",
                "coordinates": projected[0]
            };
        }
        return {
            type: "Feature",
            id: Number(this.id),
            geometry: geometry,
            properties: this.properties
        };
    }
}
