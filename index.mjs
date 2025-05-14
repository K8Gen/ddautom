import { client, v2 } from '@datadog/datadog-api-client';
import fs from 'fs';

const configuration = client.createConfiguration({
  enableRetry: true,
  authMethods: {
    apiKeyAuth: process.env.DD_API_KEY,
    appKeyAuth: process.env.DD_APP_KEY
  },
});
const v2Client = new v2.MetricsApi(configuration);


// await createTagConfiguration({
//   id: "otlp.service_stitcher.ads.padding.zero_length.duration",
//   attributes: {
//     "tags": [
//       "ecs_cluster",
//       "env",
//       "manifest",
//       "name",
//       "pluto.cluster-name",
//       "pluto_service_owner_business",
//       "plutoenv",
//       "region",
//       "request",
//       "resource",
//       "response_code",
//       "route",
//       "service",
//       "stack",
//       "stream",
//       "streaming_protocol_type",
//       "type",
//       "version",
//       "host", "host.name"
//     ]
//   },
//   "type": "manage_tags"
// })
// process.exit(0)

const tagConfigurationsResponse = await v2Client
  .listTagConfigurations()
  .catch((error) => console.error(error));


// attributes always present on manage_tags
// some metrics exist but don't have a manage_tags

// const x = tagConfigurationsResponse.data
//   .filter((tagConfiguration) => tagConfiguration.id.startsWith("service_stitcher.ad_proxy.request.time"))
// console.log(JSON.stringify(x, null, 2));
// // fs.writeFileSync('tagConfigurations.json', JSON.stringify(x, null, 2));
// process.exit(0)

const originalMergeConfig = tagConfigurationsResponse.data
  // .filter((tagConfiguration) => tagConfiguration.id.startsWith("service_stitcher.cache.alive") || tagConfiguration.id.startsWith("otlp.service_stitcher.cache.alive"))
  .filter((tagConfiguration) => tagConfiguration.id.startsWith("service_stitcher") || tagConfiguration.id.startsWith("otlp.service_stitcher"))
  .reduce((acc, tagConfiguration) => {
    if(!acc[tagConfiguration.id]) {
      acc[tagConfiguration.id] = {};
    }
    if(tagConfiguration.type === "manage_tags") {
      acc[tagConfiguration.id] = {
        tags: tagConfiguration.attributes.tags,
        excludeTagsMode: tagConfiguration.attributes.excludeTagsMode,
        metricType: tagConfiguration.attributes.metricType,
      }
    }
    return acc;
  }, {})
const updatedMergeConfig = Object.keys(originalMergeConfig)
  // .filter(key => key.startsWith("service_stitcher"))
  .reduce((acc, metricName) => {
    const tagConfiguration = { ...originalMergeConfig[metricName] };
    if(metricName.startsWith("service_stitcher")) {
      if(!tagConfiguration.tags) {
        acc[metricName] = {
          excludeTagsMode: true,
          tags: [
            "host",
            "host.name",
          ]
        }
        return acc;
      } else {
        if(tagConfiguration.excludeTagsMode) {
          // Exclude mode
          if(!tagConfiguration.tags.includes("host")) {
            tagConfiguration.tags.push("host");
          }
          if(!tagConfiguration.tags.includes("host.name")) {
            tagConfiguration.tags.push("host.name");
          }
        } else {
          // Not exclude mode
          tagConfiguration.tags = tagConfiguration.tags
            .reduce((current, tag) => {
              if(tag === "host" || tag === "host.name") {
                return current;
              }
              if(current)
                current.push(tag);
              return current
            }, []);
        }
      }
    }
    acc[metricName] = tagConfiguration;
    return acc;
  }, {})

const createConfigMetricNames = Object.entries(originalMergeConfig)
  .reduce((acc, [metricName, config]) => {
    if(!config.tags) {
      acc.push(metricName)
    }
    return acc;
  }, [])
console.log("createConfigMetricNames", JSON.stringify(createConfigMetricNames, null, 2));
const createConfigMetricMetadata = await meta(createConfigMetricNames);
console.log("createConfigMetricMetadata", JSON.stringify(createConfigMetricMetadata, null, 2));

for(const metricName of Object.keys(originalMergeConfig)) {
  if(["service_stitcher.incoming_request_completed.log_count", "service_stitcher_log_count"].includes(metricName)) {
    // These metrics cannot have tag configurations because they're generated metrics https://app.datadoghq.com/logs/pipelines/generate-metrics
    continue
  }
  let baseMetricName = metricName;
  if(baseMetricName.startsWith("otlp")) {
    baseMetricName = baseMetricName.replace("otlp.", "");
  }
  const updatedBaseMetricConfig = updatedMergeConfig[baseMetricName];
  const originalMetricConfig = originalMergeConfig[metricName];
  if(!originalMetricConfig.tags) {
    console.log(`creating metric config for ${metricName}`, JSON.stringify({
      id: metricName,
      type: "manage_tags",
      attributes: {
        ...updatedBaseMetricConfig,
        metricType: createConfigMetricMetadata[metricName].metric_type,
      },
    }, null, 2));
    await createTagConfiguration({
      id: metricName,
      type: "manage_tags",
      attributes: {
        ...updatedBaseMetricConfig,
        metricType: createConfigMetricMetadata[metricName].metric_type,
      },
    })
    continue
  }
  originalMetricConfig.tags.sort()
  updatedBaseMetricConfig.tags.sort()
  if(JSON.stringify(originalMetricConfig.tags) !== JSON.stringify(updatedBaseMetricConfig.tags) || originalMetricConfig.excludeTagsMode !== updatedBaseMetricConfig.excludeTagsMode) {
    console.log(`updating metric config for ${metricName}`, JSON.stringify(originalMetricConfig, null, 2), JSON.stringify(updatedBaseMetricConfig, null, 2));
    await updateTagConfiguration({
      id: metricName,
      type: "manage_tags",
      attributes: updatedBaseMetricConfig,
    })
    continue
  }
  // console.log(`skipping metric config for ${metricName}`, JSON.stringify(updatedBaseMetricConfig, null, 2));
}

process.exit(0);

async function meta(names) {
  let results = {};
  for(let nameSlice = names.splice(0, 20); nameSlice.length > 0; nameSlice = names.splice(0, 20)) {
    const url = new URL("https://app.datadoghq.com/metric/metric_metadata");
    for(const name of nameSlice) {
      url.searchParams.append("metrics[]", name);
    }
    const response = await fetch(url, {
      headers: {
        "Cookie": "dogweb=*"
      }
    });
    results = {...results, ...await response.json()};
  }
  return results;
}


tagConfigurationsResponse.data
  // .filter((tagConfiguration) => tagConfiguration.id.startsWith("service_stitcher") && tagConfiguration.type === "manage_tags")
  .filter((tagConfiguration) => tagConfiguration.id.startsWith("service_stitcher.route.response_code") && tagConfiguration.type === "manage_tags")
  // .filter((tagConfiguration) => tagConfiguration.id.startsWith("otlp.service_stitcher.route.response_code"))
  .forEach(async (tagConfiguration) => {
    if(tagConfiguration.attributes === undefined) {
      tagConfiguration.attributes = {
        excludeTagsMode: true,
        tags: [ 'host', 'host.name' ]
      }
    } else {
      // delete tagConfiguration.type;
      delete tagConfiguration.attributes.createdAt;
      delete tagConfiguration.attributes.modifiedAt;

      if(tagConfiguration.attributes.excludeTagsMode) {
        // Exclude mode
        if(!tagConfiguration.attributes.tags.includes("host")) {
          tagConfiguration.attributes.tags.push("host");
        }
        if(!tagConfiguration.attributes.tags.includes("host.name")) {
          tagConfiguration.attributes.tags.push("host.name");
        }
      } else {
        // Not exclude mode
        tagConfiguration.attributes.tags = tagConfiguration.attributes.tags
          .reduce((current, tag) => {
            if(tag === "host" || tag === "host.name") {
              return current;
            }
            if(current)
              current.push(tag);
            return current
          }, []);
      }
    }

    console.log(tagConfiguration);
    console.log(`updating ${tagConfiguration.id}`);
    await updateTagConfiguration(tagConfiguration)
      .catch((error) => console.error("BAD", error));


    tagConfiguration.id = `otlp.${tagConfiguration.id}`
    console.log(`updating ${tagConfiguration.id}`)
    await createTagConfiguration(tagConfiguration)
      .catch((error) => {
        console.log(`failed to update tag configuration for: ${tagConfiguration.id}.  Falling back to update.`, error);
        return updateTagConfiguration(tagConfiguration)
          .catch((error) => console.error("BAD", error));
      });

    // Not needed right now because we're allowing these metrics because it seems likes it's being treated as a integration metric
    // console.log(`updating ptv_statsd.${tagConfiguration.id}`)
    // tagConfiguration.id = `ptv_statsd.${tagConfiguration.id}`
  });


function createTagConfiguration(tagConfiguration) {
  const params = {
    body: {
      data: tagConfiguration
    },
    metricName: tagConfiguration.id,
  };

  return v2Client
    .createTagConfiguration(params)
    .then(() => console.log(`created tag configuration for: ${tagConfiguration.id}`));
}

function updateTagConfiguration(tagConfiguration) {
  const params = {
    body: {
      data: tagConfiguration
    },
    metricName: tagConfiguration.id,
  };

  return v2Client
    .updateTagConfiguration(params)
    .then(() => console.log(`updated tag configuration for: ${tagConfiguration.id}`));
}
