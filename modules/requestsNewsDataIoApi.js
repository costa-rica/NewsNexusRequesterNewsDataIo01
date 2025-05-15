const {
  Article,
  NewsApiRequest,
  EntityWhoFoundArticle,
  NewsArticleAggregatorSource,
  WebsiteDomain,
  NewsApiRequestWebsiteDomainContract,
  ArticleContent,
} = require("newsnexus07db");
const {
  writeResponseDataFromNewsAggregator,
} = require("./utilitiesReadAndMakeFiles");
const {
  checkRequestAndModifyDates,
  runSemanticScorer,
} = require("./utilitiesMisc");

async function requester(currentParams, indexMaster) {
  // Step 1: prepare paramters
  const requestWindowInDays = 10; // how many days from startDate to endDate
  const andString = currentParams.andString;
  const orString = currentParams.orString;
  const notString = currentParams.notString;
  const dateStartOfRequest = currentParams.dateStartOfRequest;
  const includeDomainsArrayString = currentParams.includeDomainsArrayString;
  const excludeDomainsArrayString = currentParams.excludeDomainsArrayString;

  const dateEndOfRequest = new Date(
    new Date().setDate(
      new Date(dateStartOfRequest).getDate() + requestWindowInDays
    )
  )
    .toISOString()
    .split("T")[0];

  const newsArticleAggregatorSourceObj =
    await NewsArticleAggregatorSource.findOne({
      where: { nameOfOrg: process.env.NAME_OF_ORG_REQUESTING_FROM },
      raw: true, // Returns data without all the database gibberish
    });

  // Step 2: Check include and exclude domain string and convert to object arrays
  const includeDomainsArray = includeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  const excludeDomainsArray = excludeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  let excludeDomainsObjArray = [];
  let includeDomainsObjArray = [];

  console.log(
    `includeDomainsArray [requester] (${includeDomainsArray.length}): ${includeDomainsArray}`
  );
  console.log(
    `excludeDomainsArray [requester] (${excludeDomainsArray.length}): ${excludeDomainsArray}`
  );

  if (includeDomainsArray.length > 0) {
    for (const domain of includeDomainsArray) {
      const domainObj = await WebsiteDomain.findOne({
        where: { name: domain },
        raw: true,
      });
      if (domainObj) {
        includeDomainsObjArray.push(domainObj);
      }
    }
  }
  if (excludeDomainsArray.length > 0) {
    for (const domain of excludeDomainsArray) {
      const domainObj = await WebsiteDomain.findOne({
        where: { name: domain },
        raw: true,
      });
      if (domainObj) {
        excludeDomainsObjArray.push(domainObj);
      }
    }
  }

  // Step 2: Modify the startDate and endDate if necessary
  const { adjustedStartDate, adjustedEndDate } =
    await checkRequestAndModifyDates(
      andString,
      orString,
      notString,
      dateStartOfRequest,
      dateEndOfRequest,
      newsArticleAggregatorSourceObj,
      requestWindowInDays
    );

  console.log(`adjustedStartDate: ${adjustedStartDate}`);
  console.log(`adjustedEndDate: ${adjustedEndDate}`);

  // Step 3: make the request
  let requestResponseData = null;
  let newsApiRequestObj = null;

  if (adjustedStartDate === adjustedEndDate) {
    console.log(`No request needed for ${requestParametersObject.andString}`);
    return adjustedEndDate;
  }

  try {
    ({ requestResponseData, newsApiRequestObj } = await makeNewsDataIoRequest(
      newsArticleAggregatorSourceObj,
      // adjustedStartDate,
      // adjustedEndDate,
      andString,
      orString,
      notString,
      includeDomainsObjArray,
      excludeDomainsObjArray,
      indexMaster
    ));
  } catch (error) {
    console.error(
      `Error during ${process.env.NAME_OF_ORG_REQUESTING_FROM} API request:`,
      error
    );
    return; // prevent proceeding to storeGNewsArticles if request failed
  }

  // console.log(
  //   "-----> [in requester after makeNewsApiRequestDetailed] newsApiRequestObj ",
  //   newsApiRequestObj
  // );
  // Step 4: store the articles
  if (!requestResponseData?.results) {
    console.log(
      `No articles received from ${process.env.NAME_OF_ORG_REQUESTING_FROM} request response`
    );
  } else {
    // Store articles and update NewsApiRequest
    await storeNewsApiArticles(requestResponseData, newsApiRequestObj);
    console.log(`completed NewsApiRequest.id: ${newsApiRequestObj.id}`);
  }

  // return "2025-05-03";
  return adjustedEndDate;
}

// Make a single requuest to the News Data IO API
async function makeNewsDataIoRequest(
  source,
  // startDate,
  // endDate,
  keywordsAnd,
  keywordsOr,
  keywordsNot,
  includeWebsiteDomainObjArray = [],
  excludeWebsiteDomainObjArray = [],
  indexMaster
) {
  // console.log(`keywordsAnd: ${keywordsAnd}, ${typeof keywordsAnd}`);
  // console.log(`keywordsOr: ${keywordsOr}, ${typeof keywordsOr}`);
  // console.log(`keywordsNot: ${keywordsNot}, ${typeof keywordsNot}`);

  // console.log(
  //   `---> includeWebsiteDomainObjArray: ${includeWebsiteDomainObjArray}, ${typeof includeWebsiteDomainObjArray}`
  // );
  // console.log(
  //   `---> excludeWebsiteDomainObjArray: ${JSON.stringify(
  //     excludeWebsiteDomainObjArray
  //   )}, ${typeof excludeWebsiteDomainObjArray}`
  // );

  function splitPreservingQuotes(str) {
    return str.match(/"[^"]+"|\S+/g)?.map((s) => s.trim()) || [];
  }

  const andArray = splitPreservingQuotes(keywordsAnd ? keywordsAnd : "");
  const orArray = splitPreservingQuotes(keywordsOr ? keywordsOr : "");
  const notArray = splitPreservingQuotes(keywordsNot ? keywordsNot : "");

  let includeSourcesArray;
  let excludeSourcesArray;
  // console.log(`includeWebsiteDomainObjArray: ${includeWebsiteDomainObjArray}`);
  // console.log(`excludeWebsiteDomainObjArray: ${excludeWebsiteDomainObjArray}`);

  if (includeWebsiteDomainObjArray.length === 0) {
    includeSourcesArray = null;
  } else {
    console.log("THIS SHOULD NOT FIRE");
    includeSourcesArray = includeWebsiteDomainObjArray
      .splice(0, 4)
      .map((obj) => obj.name);
  }
  if (excludeWebsiteDomainObjArray.length === 0) {
    excludeSourcesArray = null;
  } else {
    excludeSourcesArray = excludeWebsiteDomainObjArray
      .splice(0, 4)
      .map((obj) => obj.name);
  }

  // Step 1: prepare dates
  // if (!endDate) {
  const endDate = new Date().toISOString().split("T")[0];
  // }

  // if (
  //   !startDate ||
  //   new Date(startDate) <
  //     new Date(new Date().setDate(new Date().getDate() - 29))
  // ) {
  //   // startDate should be 29 days prior to endDate - account limitation
  //   startDate = new Date(new Date().setDate(new Date().getDate() - 29))
  //     .toISOString()
  //     .split("T")[0];
  // }

  // const startDateTest = new Date(startDate);

  // console.log("-------");
  // console.log(`startDate: ${startDate} ${typeof startDate}`);
  // console.log("-------");
  let queryParams = [];

  if (includeSourcesArray && includeSourcesArray.length > 0) {
    queryParams.push(`domainurl=${includeSourcesArray.join(",")}`);
  }

  if (excludeSourcesArray && excludeSourcesArray.length > 0) {
    queryParams.push(`excludedomain=${excludeSourcesArray.join(",")}`);
  }

  const andPart = andArray.length > 0 ? andArray.join(" AND ") : "";
  const orPart = orArray.length > 0 ? `(${orArray.join(" OR ")})` : "";
  const notPart =
    notArray.length > 0 ? notArray.map((k) => `NOT ${k}`).join(" AND ") : "";

  const fullQuery = [andPart, orPart, notPart].filter(Boolean).join(" AND ");

  if (fullQuery) {
    queryParams.push(`q=${encodeURIComponent(fullQuery)}`);
  }

  // if (startDate) {
  //   queryParams.push(`from=${startDate}`);
  // }

  // if (endDate) {
  //   queryParams.push(`to=${endDate}`);
  // }

  // Always required
  queryParams.push("language=en");
  queryParams.push(`apiKey=${source.apiKey}`);
  queryParams.push(`removeduplicate=1`);
  queryParams.push(`country=us`);
  queryParams.push(`excludecategory=entertainment,politics,world`);

  const requestUrl = `${source.url}latest?${queryParams.join("&")}`;
  // console.log("- [makeNewsApiRequestDetailed] requestUrl", requestUrl);
  let status = "success";
  let requestResponseData = null;
  // let newsApiRequest = null;
  let newsApiRequestObj = null;

  console.log("requestUrl: ", requestUrl);

  if (process.env.ACTIVATE_API_REQUESTS_TO_OUTSIDE_SOURCES === "true") {
    const response = await fetch(requestUrl);
    requestResponseData = await response.json();

    if (requestResponseData.status === "error") {
      status = "error";
      // console.log(" #1 writeResponseDataFromNewsAggregator");
      writeResponseDataFromNewsAggregator(
        source.id,
        { id: `failed_indexMaster${indexMaster}`, url: requestUrl },
        requestResponseData,
        true
      );
      await handleErrorNewsDataIoRequest(requestResponseData);

      // This is where we end the process if rate limited
      if (
        requestResponseData.results?.code === "RateLimitExceeded" ||
        requestResponseData.results?.message?.includes("Rate limit exceeded")
      ) {
        console.log(
          `--> ⛔ Ending process: rate limited by ${process.env.NAME_OF_ORG_REQUESTING_FROM}`
        );
        runSemanticScorer();
        process.exit(1);
      }
    }
    // Step 4: create new NewsApiRequest
    newsApiRequestObj = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      // dateStartOfRequest: startDate,
      dateEndOfRequest: endDate,
      countOfArticlesReceivedFromRequest: requestResponseData.results?.length,
      countOfArticlesAvailableFromRequest: requestResponseData.totalResults,
      status,
      url: requestUrl,
      andString: keywordsAnd,
      orString: keywordsOr,
      notString: keywordsNot,
      isFromAutomation: true,
    });

    for (const domain of includeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequestObj.id,
        websiteDomainId: domain.id,
        includedOrExcludedFromRequest: "included",
      });
    }
    for (const domain of excludeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequestObj.id,
        websiteDomainId: domain.id,
        includedOrExcludedFromRequest: "excluded",
      });
    }
  } else {
    newsApiRequestObj = requestUrl;
  }

  // console.log(
  //   "-----> [in makeNewsApiRequestDetailed] newsApiRequestObj ",
  //   newsApiRequestObj
  // );

  return { requestResponseData, newsApiRequestObj };
}

async function storeNewsApiArticles(requestResponseData, newsApiRequest) {
  // console.log("-----> newsApiRequest ", newsApiRequest);

  // leverages the hasOne association from the NewsArticleAggregatorSource model
  const newsApiSource = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: process.env.NAME_OF_ORG_REQUESTING_FROM },
    include: [{ model: EntityWhoFoundArticle }],
  });

  const entityWhoFoundArticleId = newsApiSource.EntityWhoFoundArticle?.id;

  try {
    let countOfArticlesSavedToDbFromRequest = 0;
    for (let article of requestResponseData.results) {
      // Append article

      const existingArticle = await Article.findOne({
        where: { url: article.link },
      });
      if (existingArticle) {
        continue;
      }
      const newArticle = await Article.create({
        publicationName: article.source_name,
        title: article.title,
        author: article?.creator?.[0],
        description: article.description,
        url: article.link,
        urlToImage: article.image_url,
        publishedDate: article.pubDate,
        entityWhoFoundArticleId: entityWhoFoundArticleId,
        newsApiRequestId: newsApiRequest.id,
      });

      if (article?.content) {
        // Append ArticleContent
        await ArticleContent.create({
          articleId: newArticle.id,
          content: article.content,
        });
      }
      countOfArticlesSavedToDbFromRequest++;
    }
    // Append NewsApiRequest
    await newsApiRequest.update({
      countOfArticlesSavedToDbFromRequest: countOfArticlesSavedToDbFromRequest,
    });
    // console.log(" #2 writeResponseDataFromNewsAggregator");
    writeResponseDataFromNewsAggregator(
      newsApiSource.id,
      newsApiRequest,
      requestResponseData,
      false
      // newsApiRequest.url
    );
  } catch (error) {
    console.error(error);
    requestResponseData.error = error;
    // console.log(" #3 writeResponseDataFromNewsAggregator");
    writeResponseDataFromNewsAggregator(
      newsApiSource.id,
      newsApiRequest,
      requestResponseData,
      true
      // newsApiRequest.url
    );
  }
}

async function handleErrorNewsDataIoRequest(requestResponseData) {
  if (
    Array.isArray(requestResponseData.results?.message) &&
    typeof requestResponseData.results.message[0]?.message === "string" &&
    requestResponseData.results.message[0].message.includes(
      "The domain you provided does not exist"
    )
  ) {
    console.log(
      "- [makeNewsDataIoRequest] invalid domain: ",
      requestResponseData.results?.message?.[0]?.invalid_domain
    );
    await WebsiteDomain.update(
      {
        isArchievedNewsDataIo: true,
      },
      {
        where: {
          name: requestResponseData.results.message[0].invalid_domain,
        },
      }
    );
  } else {
    console.log("Correctly handled invalid_domain with no message 🤩");
  }

  if (requestResponseData.results.message[0]?.suggestion) {
    console.log(
      "- [makeNewsDataIoRequest] suggestion: ",
      requestResponseData.results.message[0].suggestion
    );
    for (const msg of requestResponseData.results.message) {
      const invalidDomain = msg.invalid_domain;
      const suggestions = msg.suggestion;

      if (invalidDomain) {
        console.log(
          "- [makeNewsDataIoRequest] Archiving invalid domain:",
          invalidDomain
        );
        await WebsiteDomain.update(
          { isArchievedNewsDataIo: true },
          { where: { name: invalidDomain } }
        );
      }

      if (Array.isArray(suggestions)) {
        for (const suggestion of suggestions) {
          try {
            const websiteDomain = await WebsiteDomain.create({
              name: suggestion,
            });
            console.log(
              "- [makeNewsDataIoRequest] Added suggestion:",
              websiteDomain.name
            );
          } catch (err) {
            console.warn(
              `⚠️ Failed to add suggestion ${suggestion}:`,
              err.message
            );
          }
        }
      }
    }
  }
}

module.exports = {
  requester,
};
