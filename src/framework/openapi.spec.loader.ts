import { dereferenceParameter } from '../middlewares/parsers/util';
import { OpenAPIFramework } from './index';
import {
  OpenAPIFrameworkAPIContext,
  OpenAPIV3,
  OpenAPIFrameworkArgs,
} from './types';

export interface Spec {
  apiDoc: OpenAPIV3.DocumentV3 | OpenAPIV3.DocumentV3_1;
  basePaths: string[];
  routes: RouteMetadata[];
  serial: number;
}

export interface RouteMetadata {
  basePath: string;
  expressRoute: string;
  openApiRoute: string;
  method: string;
  pathParams: string[];
}

interface DiscoveredRoutes {
  apiDoc: OpenAPIV3.DocumentV3 | OpenAPIV3.DocumentV3_1;
  basePaths: string[];
  routes: RouteMetadata[];
  serial: number;
}
// Sort routes by most specific to least specific i.e. static routes before dynamic
// e.g. /users/my_route before /users/{id}
// Exported for tests
export const sortRoutes = (r1, r2) => {
  const e1 = r1.expressRoute.replace(/\/:/g, '/~');
  const e2 = r2.expressRoute.replace(/\/:/g, '/~');
  return e1 > e2 ? 1 : -1;
};

// Uniquely identify the Spec that is emitted
let serial = 0;

export class OpenApiSpecLoader {
  private readonly framework: OpenAPIFramework;
  constructor(opts: OpenAPIFrameworkArgs) {
    this.framework = new OpenAPIFramework(opts);
  }

  public async load(): Promise<Spec> {
    return this.discoverRoutes();
  }

  private async discoverRoutes(): Promise<DiscoveredRoutes> {
    const routes: RouteMetadata[] = [];
    const toExpressParams = this.toExpressParams;
    // const basePaths = this.framework.basePaths;
    // let apiDoc: OpenAPIV3.DocumentV3 | OpenAPIV3.DocumentV3_1 = null;
    // let basePaths: string[] = null;
    const { apiDoc, basePaths } = await this.framework.initialize({
      visitApi(ctx: OpenAPIFrameworkAPIContext): void {
        const apiDoc = ctx.getApiDoc();
        const basePaths = ctx.basePaths;
        for (const bpa of basePaths) {
          const bp = bpa.replace(/\/$/, '');
          if (apiDoc.paths) {
            for (const [path, methods] of Object.entries(apiDoc.paths)) {
              for (const [method, schema] of Object.entries(methods)) {
                if (
                  method.startsWith('x-') ||
                  ['parameters', 'summary', 'description'].includes(method)
                ) {
                  continue;
                }

                const pathParams = [
                  ...(schema.parameters ?? []),
                  ...(methods.parameters ?? []),
                ]
                  .map(param => dereferenceParameter(apiDoc, param))
                  .filter(param => param.in === 'path')
                  .map(param => param.name);

                const openApiRoute = `${bp}${path}`;
                const expressRoute = `${openApiRoute}`
                  .split(':')
                  .map(toExpressParams)
                  .join('\\:');
  
                routes.push({
                  basePath: bp,
                  expressRoute,
                  openApiRoute,
                  method: method.toUpperCase(),
                  pathParams: Array.from(new Set(pathParams)),
                });
              }
            }
          }
        }
      },
    });

    routes.sort(sortRoutes);

    serial = serial + 1;
    return {
      apiDoc,
      basePaths,
      routes,
      serial
    };
  }

  private toExpressParams(part: string): string {
    // substitute wildcard path with express equivalent
    // {/path} => /path(*) <--- RFC 6570 format (not supported by openapi)
    // const pass1 = part.replace(/\{(\/)([^\*]+)(\*)}/g, '$1:$2$3');

    //if wildcard path use new path-to-regex expected model
    if(/[*]/g.test(part)){
      // /v1/{path}* => /v1/*path)
      // /v1/{path}(*) => /v1/*path)
      const pass1 = part.replace(/\/{([^}]+)}\({0,1}(\*)\){0,1}/g, '/$2$1');

      // substitute params with express equivalent
      // /path/{multi}/test/{/*path}=> /path/:multi/test/{/*path}
      return pass1.replace(/\{([^\/}]+)}/g, ':$1');
      //return pass1;
    }
    // instead create our own syntax that is compatible with express' pathToRegex
    // /{path}* => /:path*)
    // /{path}(*) => /:path*)
    const pass1 = part.replace(/\/{([^}]+)}\({0,1}(\*)\){0,1}/g, '/:$1$2');

    // substitute params with express equivalent
    // /path/{id} => /path/:id
    return pass1.replace(/\{([^}]+)}/g, ':$1');
  }
}
